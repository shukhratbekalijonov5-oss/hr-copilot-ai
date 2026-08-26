import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { APPLICANT_CANDIDATE_SCOPE } from '../common/vacancy-access/applicant-scope';
import {
  AiServiceClient,
  AiServiceDisabledError,
  type AiJobMatch,
  type AiJobMatchResult,
  type SupportedLocale,
} from '../ai/ai-service.client';
import { CandidateEvidenceLifecycleService } from '../candidate-evidence/candidate-evidence.service';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';
import { NO_CANDIDATE_EVIDENCE } from '../candidate-evidence/evidence-policy';
import { buildAiProfile } from '../candidate-account/candidate-account.service';
import { matchBand } from '../matching/match-policy';
import { buildMatchInsight } from '../matching/advanced/build-insight';
import { countIndependentEvidenceSources } from '../matching/advanced/evidence-confidence';
import { buildProfileFacts } from '../matching/advanced/profile-facts';
import type { MatchInsight } from '../matching/advanced/advanced-match.types';
import type {
  CompareInsightCandidate,
  CompareInsightsResponse,
  CompareSuperlative,
  HrMatchInsightResponse,
} from './match-insight.types';

/**
 * HR vacancy-context candidate assessment — the SAME advanced engine the
 * candidate's Internal AI Job Match runs, pointed at one (applicant, owned
 * vacancy) pair.
 *
 * ## One engine, two contexts
 *
 * The capability analysis comes from the identical ai-service pipeline
 * (`/internal/candidate/job-matches` with a one-vacancy universe), and the
 * insight from the identical `buildMatchInsight`. What differs is DECLARED
 * INPUT, not algorithm: HR context passes no intent and no alignments —
 * a candidate's stated preferences (salary, locations, exclusions) are
 * private to the candidate and never surface on a recruiter screen. With no
 * intent the canonical score equals the capability score by the match-policy
 * formula, so the number HR sees is the same evidence-side score that anchors
 * the candidate's own list.
 *
 * ## Scoping
 *
 * Exactly the evidence-map chain: owned vacancy → org-scoped applicant
 * (APPLICANT predicate) → candidate-in-vacancy → live candidate account.
 * Retrieval is bounded by `allowedSourceIds` = the candidate's CURRENT
 * personal sources (Rule N1; `[]` retrieves nothing).
 *
 * ## Statefulness
 *
 * None. Every call recomputes from current state (like the evidence-map run),
 * so there is no HR-side snapshot to invalidate and nothing stale to serve.
 * `scoreChange` is therefore always null in this context.
 */
@Injectable()
export class MatchInsightService {
  private readonly logger = new Logger(MatchInsightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly ai: AiServiceClient,
    private readonly ownedVacancies: OwnedVacancyService,
    private readonly evidence: CandidateEvidenceLifecycleService,
    private readonly producer: DocumentProcessingProducer,
  ) {}

  async assess(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
    locale: SupportedLocale,
  ): Promise<HrMatchInsightResponse> {
    const scope = await this.assertScope(
      organizationId,
      userId,
      candidateId,
      vacancyId,
    );
    const core = await this.assessCore(scope, locale);
    return {
      candidate: { id: scope.candidate.id, fullName: scope.candidate.fullName },
      vacancy: {
        id: scope.vacancy.id,
        title: scope.vacancy.title,
        status: scope.vacancy.status,
      },
      score: core.match.score,
      capabilityScore: core.match.score,
      tier: core.match.match,
      band: matchBand(core.match.score, core.match.match),
      matchedSkills: core.match.matchedSkills ?? [],
      missingSkills: core.match.missingSkills ?? [],
      insight: core.insight,
      generatedAt: new Date().toISOString(),
    };
  }

  async compare(
    organizationId: string,
    userId: string,
    vacancyId: string,
    candidateIds: string[],
    locale: SupportedLocale,
  ): Promise<CompareInsightsResponse> {
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);
    const unique = [...new Set(candidateIds)];

    const rows: CompareInsightCandidate[] = [];
    // Sequential on purpose: the AI service runs a single worker, and compare
    // is a human-paced screen — N parallel capability runs would contend with
    // every other user's ranking for no perceptible gain.
    for (const candidateId of unique) {
      rows.push(
        await this.compareRow(
          organizationId,
          userId,
          candidateId,
          vacancyId,
          locale,
        ),
      );
    }

    const scope = await this.prisma.vacancy.findFirst({
      where: { id: vacancyId, ...this.tenant.scope(organizationId) },
      select: { id: true, title: true, status: true },
    });
    this.tenant.assertFound(scope, 'Vacancy');

    return {
      vacancy: scope!,
      candidates: rows,
      superlatives: superlativesOf(rows),
      generatedAt: new Date().toISOString(),
    };
  }

  private async compareRow(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
    locale: SupportedLocale,
  ): Promise<CompareInsightCandidate> {
    const empty = (
      fullName: string,
      error: string,
    ): CompareInsightCandidate => ({
      candidateId,
      fullName,
      score: null,
      band: null,
      eligibility: null,
      evidenceConfidence: null,
      mustHaveGapCount: null,
      dimensions: [],
      error,
    });
    let fullName = '';
    try {
      const scope = await this.assertScope(
        organizationId,
        userId,
        candidateId,
        vacancyId,
      );
      fullName = scope.candidate.fullName;
      const core = await this.assessCore(scope, locale);
      const mustRows = core.insight.requirementMatrix.filter(
        (r) => r.priority === 'MUST_HAVE',
      );
      return {
        candidateId,
        fullName,
        score: core.match.score,
        band: matchBand(core.match.score, core.match.match),
        eligibility: core.insight.eligibility,
        evidenceConfidence: core.insight.evidenceConfidence,
        mustHaveGapCount: mustRows.filter(
          (r) => r.status !== 'STRONG' && r.status !== 'MATCH',
        ).length,
        dimensions: core.insight.dimensions,
        error: null,
      };
    } catch (error) {
      // One unassessable candidate must not sink the whole comparison —
      // the row states WHY it is empty instead. Genuine outages still throw.
      if (error instanceof UnprocessableEntityException) {
        return empty(fullName, NO_CANDIDATE_EVIDENCE);
      }
      if (error instanceof NotFoundException) {
        return empty(fullName, 'CANDIDATE_NOT_FOUND');
      }
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      const code = (error as { response?: { code?: string } })?.response?.code;
      if (code === 'CANDIDATE_NOT_IN_VACANCY') {
        return empty(fullName, code);
      }
      throw error;
    }
  }

  /** The shared computation both surfaces stand on. */
  private async assessCore(
    scope: Awaited<ReturnType<MatchInsightService['assertScope']>>,
    locale: SupportedLocale,
  ): Promise<{ match: AiJobMatch; insight: MatchInsight }> {
    const { vacancy, account } = scope;

    // The index only serves OPEN vacancies, and eligibility for a non-open
    // one is a settled question, not an analysis.
    if (vacancy.status !== 'OPEN') {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `This vacancy is ${vacancy.status}; match insight is computed for OPEN vacancies only.`,
        code: 'VACANCY_NOT_OPEN',
      });
    }

    const counts = await this.evidence.activeSourceCounts(account.id);
    if (counts.total === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message:
          'This candidate currently has no evidence sources (documents or links), so there is nothing to analyze.',
        code: NO_CANDIDATE_EVIDENCE,
      });
    }
    const allowedSourceIds = await this.evidence.activePersonalSourceIds(
      account.id,
    );

    let result: AiJobMatchResult;
    try {
      result = await this.ai.candidateJobMatches({
        candidateAccountId: account.id,
        profile: buildAiProfile(account),
        locale,
        eligibleVacancyIds: [vacancy.id],
        explainOffset: 0,
        // Deterministic analysis only — prose belongs to the existing
        // summary/interview surfaces. Gemini is not consulted here at all.
        explainLimit: 0,
        allowedSourceIds,
      });
    } catch (error) {
      if (error instanceof AiServiceDisabledError) {
        throw new ServiceUnavailableException(
          'AI features are not available right now.',
        );
      }
      throw error;
    }

    const match = result.matches.find((m) => m.vacancyId === vacancy.id);
    if (!match) {
      // The vacancy is OPEN in the database but absent from the index — a
      // sync gap. Queue the heal and say so rather than inventing zeros.
      await this.producer
        .enqueueVacancyIndexSync({ vacancyId: vacancy.id })
        .catch(() => undefined);
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message:
          'This vacancy is not in the match index yet; indexing has been queued. Try again shortly.',
        code: 'MATCH_INDEX_PENDING',
      });
    }

    const capability = result.capability ?? {};
    const insight = buildMatchInsight({
      context: 'HR',
      match,
      // No intent in HR context → canonical = capability score.
      canonicalScore: match.score,
      vacancyTitle: vacancy.title,
      vacancySeniority: vacancy.seniorityLevel,
      vacancyLanguages: vacancy.languages,
      vacancyStatus: vacancy.status,
      alignments: [],
      intent: null,
      profile: buildProfileFacts(account),
      capabilitySkills: Array.isArray(capability.skills)
        ? (capability.skills as string[])
        : [],
      evidenceSourceCount: countIndependentEvidenceSources(
        capability.evidenceSources,
      ),
      evidenceChars:
        typeof capability.evidenceChars === 'number'
          ? capability.evidenceChars
          : 0,
      previous: null,
      currentYear: new Date().getUTCFullYear(),
    });

    return { match, insight };
  }

  private async assertScope(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
  ) {
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);
    const [candidate, vacancy] = await Promise.all([
      this.prisma.candidate.findFirst({
        where: {
          id: candidateId,
          ...this.tenant.scope(organizationId),
          ...APPLICANT_CANDIDATE_SCOPE,
        },
        select: {
          id: true,
          fullName: true,
          candidateAccount: { select: { id: true } },
        },
      }),
      this.prisma.vacancy.findFirst({
        where: { id: vacancyId, ...this.tenant.scope(organizationId) },
        select: {
          id: true,
          title: true,
          status: true,
          seniorityLevel: true,
          languages: {
            select: { languageCode: true, level: true, required: true },
            orderBy: { languageCode: 'asc' },
          },
        },
      }),
    ]);
    this.tenant.assertFound(candidate, 'Candidate');
    this.tenant.assertFound(vacancy, 'Vacancy');
    await this.ownedVacancies.assertCandidateInVacancy(vacancyId, candidateId);
    if (!candidate!.candidateAccount) {
      throw new NotFoundException('Candidate not found');
    }
    const account = await this.prisma.candidateAccount.findUnique({
      where: { id: candidate!.candidateAccount.id },
    });
    if (!account) throw new NotFoundException('Candidate not found');
    return { candidate: candidate!, vacancy: vacancy!, account };
  }
}

/** Deterministic winners — every superlative pinned to its number. */
function superlativesOf(rows: CompareInsightCandidate[]) {
  const assessed = rows.filter((r) => r.error === null);
  const pick = (
    candidates: CompareInsightCandidate[],
    value: (row: CompareInsightCandidate) => number | null,
    direction: 'MAX' | 'MIN',
  ): CompareSuperlative | null => {
    const scored = candidates
      .map((row) => ({ row, value: value(row) }))
      .filter(
        (x): x is { row: CompareInsightCandidate; value: number } =>
          x.value !== null,
      );
    if (scored.length < 2) return null;
    scored.sort(
      (a, b) =>
        (direction === 'MAX' ? b.value - a.value : a.value - b.value) ||
        (b.row.score ?? 0) - (a.row.score ?? 0) ||
        a.row.candidateId.localeCompare(b.row.candidateId),
    );
    const best = scored[0];
    return {
      candidateId: best.row.candidateId,
      fullName: best.row.fullName,
      value: best.value,
    };
  };

  const dimension = (row: CompareInsightCandidate, key: string) =>
    row.dimensions.find((d) => d.key === key)?.normalizedScore ?? null;

  return {
    bestTechnicalMatch: pick(
      assessed,
      (r) => dimension(r, 'mustHaveSkills') ?? r.score,
      'MAX',
    ),
    bestSeniorityFit: pick(
      assessed,
      (r) => dimension(r, 'seniorityFit'),
      'MAX',
    ),
    fewestMustHaveGaps: pick(assessed, (r) => r.mustHaveGapCount, 'MIN'),
    highestEvidenceConfidence: pick(
      assessed,
      (r) => r.evidenceConfidence,
      'MAX',
    ),
  };
}
