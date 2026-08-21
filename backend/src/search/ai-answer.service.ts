import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import {
  AiServiceClient,
  AiServiceDisabledError,
  isSupportedLocale,
  type AiRagResult,
  type AiVacancyContext,
  type SupportedLocale,
} from '../ai/ai-service.client';
import { CandidateEvidenceLifecycleService } from '../candidate-evidence/candidate-evidence.service';

/**
 * Grounded AI answers, candidate summaries and interview questions — all
 * under the vacancy-scoped workspace rule.
 *
 * Everything here is tenant-scoped from the authenticated user, and every
 * candidate or vacancy id supplied by the client is verified against that
 * organization *before* it reaches the AI service. On top of that:
 *
 *  - a supplied vacancyId must be one of the CALLER'S OWN vacancies
 *    (403 VACANCY_NOT_OWNED for a same-org colleague's);
 *  - the candidate-detail surfaces (Ask-with-candidate, Summary, Interview
 *    Questions) REQUIRE the selected vacancy, and the candidate must be
 *    associated with it (403 CANDIDATE_NOT_IN_VACANCY);
 *  - the selected vacancy's title/requirements are sent as generation
 *    grounding, so switching vacancy A → B changes the actual context —
 *    nothing is cached server-side under the wrong vacancy (no generation
 *    cache exists; every call re-resolves and regenerates).
 *
 * The one deliberately vacancy-less mode is the AI Search page's org-wide
 * grounded answer (no candidateId, no vacancyId): evidence search across the
 * organization remains lawful without a selection.
 */
@Injectable()
export class AiAnswerService {
  private readonly logger = new Logger(AiAnswerService.name);

  constructor(
    private readonly ai: AiServiceClient,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly ownedVacancies: OwnedVacancyService,
    private readonly evidence: CandidateEvidenceLifecycleService,
  ) {}

  async answer(
    organizationId: string,
    userId: string,
    input: {
      query: string;
      candidateId?: string;
      vacancyId?: string;
      locale?: SupportedLocale;
      limit?: number;
    },
  ) {
    // Candidate Detail "Ask" is always asked UNDER a selected vacancy.
    if (input.candidateId && !input.vacancyId) {
      throw new BadRequestException(
        'vacancyId is required when asking about a candidate',
      );
    }
    if (input.candidateId) {
      await this.assertCandidate(organizationId, input.candidateId);
    }
    let vacancyContext: AiVacancyContext | null = null;
    if (input.vacancyId) {
      const vacancy = await this.ownedVacancies.requireOwnedWithRequirements(
        userId,
        organizationId,
        input.vacancyId,
      );
      if (input.candidateId) {
        await this.ownedVacancies.assertCandidateInVacancy(
          input.vacancyId,
          input.candidateId,
        );
      }
      vacancyContext = toVacancyContext(vacancy);
    }
    const locale = await this.resolveLocale(userId, input.locale);

    // Ask-about-a-candidate is restricted to that candidate's SURVIVING
    // sources. The org-wide mode has no candidate to scope by and passes null;
    // its results are filtered against surviving sources by SearchService on
    // the way back instead.
    const allowedSourceIds = input.candidateId
      ? await this.evidence.activeApplicationSourceIds(
          organizationId,
          input.candidateId,
        )
      : null;

    const answer = await this.guard('answer questions', () =>
      this.ai.answerQuestion({
        organizationId,
        query: input.query,
        candidateId: input.candidateId ?? null,
        vacancyId: input.vacancyId ?? null,
        vacancy: vacancyContext,
        locale,
        limit: input.limit,
        allowedSourceIds,
      }),
    );

    // The org-wide mode had no allowlist, so enforce the rule on the way back
    // instead: a withdrawn source must never be cited.
    return allowedSourceIds === null
      ? this.dropWithdrawnCitations(organizationId, answer)
      : answer;
  }

  /**
   * Removes citations naming sources that no longer exist, and says so.
   *
   * Only the organization-wide Ask needs this. Every other AI surface is
   * scoped to one candidate, so it can send a small list of surviving source
   * ids and have the index filter before retrieval. Organization-wide there is
   * no such list — sending every source id an organization owns would be an
   * unbounded filter that silently degrades as the corpus grows, which is
   * worse than no filter, because it would look like one.
   *
   * So the guarantee here is enforced where it is bounded: on the handful of
   * citations actually returned. A withdrawn source can never be cited, and if
   * one was, the answer stops being reported as GROUNDED — its prose may have
   * been shaped by evidence that no longer exists, and a human should look.
   * (The window is only between a delete committing and its eviction
   * completing; the citations are the part that would be user-visible.)
   */
  private async dropWithdrawnCitations(
    organizationId: string,
    answer: AiRagResult,
  ): Promise<AiRagResult> {
    if (answer.citations.length === 0) return answer;

    const ids = [...new Set(answer.citations.map((c) => c.documentId))];
    const [documents, linkSources] = await Promise.all([
      this.prisma.document.findMany({
        where: { id: { in: ids }, organizationId },
        select: { id: true },
      }),
      this.prisma.applicationLinkSource.findMany({
        where: { id: { in: ids }, organizationId },
        select: { id: true },
      }),
    ]);
    const surviving = new Set([
      ...documents.map((d) => d.id),
      ...linkSources.map((s) => s.id),
    ]);

    const kept = answer.citations.filter((c) => surviving.has(c.documentId));
    if (kept.length === answer.citations.length) return answer;

    this.logger.warn(
      `Dropped ${answer.citations.length - kept.length} citation(s) naming ` +
        `withdrawn sources from an organization-wide answer`,
    );
    return {
      ...answer,
      citations: kept,
      status:
        kept.length === 0 ? 'INSUFFICIENT_EVIDENCE' : 'NEEDS_HUMAN_REVIEW',
    };
  }

  /**
   * Locale precedence (documented product rule):
   *   explicit request locale → the user's preferredLocale → 'en'.
   * The client's explicit choice always wins; the account-level preference
   * only fills the gap when the client sent none. Nothing here detects the
   * query's language — language selection is a user setting, not a guess.
   */
  private async resolveLocale(
    userId: string,
    requested: SupportedLocale | undefined,
  ): Promise<SupportedLocale> {
    if (requested) return requested;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLocale: true },
    });
    const resolved =
      user && isSupportedLocale(user.preferredLocale)
        ? user.preferredLocale
        : 'en';
    // Safe metadata only — no query text, no tokens.
    this.logger.log(
      `AI generation locale: requested=none resolved=${resolved}`,
    );
    return resolved;
  }

  /**
   * Vacancy-contextual candidate summary: "what does this candidate's
   * evidence state as it relates to THIS selected vacancy". The vacancy is
   * REQUIRED, must be the caller's own, and the candidate must be associated
   * with it — a summary generated under vacancy A is never served under B
   * (nothing is cached; the vacancy context is part of every generation).
   */
  async summariseCandidate(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
    locale?: SupportedLocale,
  ) {
    await this.assertCandidate(organizationId, candidateId);
    const vacancy = await this.ownedVacancies.requireOwnedWithRequirements(
      userId,
      organizationId,
      vacancyId,
    );
    await this.ownedVacancies.assertCandidateInVacancy(vacancyId, candidateId);
    const resolved = await this.resolveLocale(userId, locale);
    const allowedSourceIds = await this.evidence.activeApplicationSourceIds(
      organizationId,
      candidateId,
    );

    return this.guard('summarise candidates', () =>
      this.ai.summariseCandidate({
        organizationId,
        candidateId,
        locale: resolved,
        vacancy: toVacancyContext(vacancy),
        allowedSourceIds,
      }),
    );
  }

  async interviewQuestions(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
    locale?: SupportedLocale,
  ) {
    await this.assertCandidate(organizationId, candidateId);
    const vacancy = await this.ownedVacancies.requireOwnedWithRequirements(
      userId,
      organizationId,
      vacancyId,
    );
    await this.ownedVacancies.assertCandidateInVacancy(vacancyId, candidateId);
    const resolvedLocale = await this.resolveLocale(userId, locale);
    const allowedSourceIds = await this.evidence.activeApplicationSourceIds(
      organizationId,
      candidateId,
    );

    return this.guard('generate interview questions', () =>
      this.ai.interviewQuestions({
        organizationId,
        candidateId,
        vacancyId,
        requirements: vacancy.requirements.map((r) => ({
          requirementId: r.id,
          text: r.text,
          type: r.type,
          required: r.required,
        })),
        locale: resolvedLocale,
        allowedSourceIds,
      }),
    );
  }

  /**
   * Turns an unconfigured AI service into a clear 503.
   *
   * Note this only wraps *generation*. Semantic search and evidence mapping
   * deliberately do not depend on the LLM, so they keep working when it is
   * unavailable.
   */
  private async guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AiServiceDisabledError) {
        throw new ServiceUnavailableException(
          `Cannot ${operation}: the AI service is not configured`,
        );
      }
      throw error;
    }
  }

  private async assertCandidate(organizationId: string, candidateId: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, ...this.tenant.scope(organizationId) },
      select: { id: true },
    });
    return this.tenant.assertFound(candidate, 'Candidate');
  }
}

/** Candidate-visible grounding fields only — never recruiter-private data. */
function toVacancyContext(vacancy: {
  id: string;
  title: string;
  requirements: { text: string; required: boolean }[];
}): AiVacancyContext {
  return {
    vacancyId: vacancy.id,
    title: vacancy.title,
    requirements: vacancy.requirements.map((r) => ({
      text: r.text,
      required: r.required,
    })),
  };
}
