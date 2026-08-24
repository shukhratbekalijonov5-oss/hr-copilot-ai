import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import { FxRateService } from '../../fx/fx-rate.service';
import { searchAlignment } from '../../matching/search-alignment';
import type { SearchSecondaryFilters } from '../../matching/search-alignment';
import type { NormalizedJobFeatures } from '../../matching/normalized-job-features';
import type { CandidateJobIntent } from '../../candidate-preferences/candidate-job-intent';

/**
 * THE grounded context every MAX premium external-AI feature reads.
 *
 * Task 4C.6 ("why this match") is the first consumer. Cover Letter, Interview
 * Prep and Advanced Match Breakdown are not built yet and are not stubbed
 * here — but each of them needs exactly these three things, and needs them to
 * mean the same thing, which is why this is a service rather than three
 * private helpers inside one endpoint:
 *
 *   1. the candidate's CURRENT professional profile (Rule N1),
 *   2. ONE canonical external job as stored,
 *   3. the deterministic match facts the system already computed.
 *
 * ## What it deliberately does not do
 *
 * It does not rank, score, retrieve, embed, or call a model. Nothing here can
 * change what a search returned or in what order. The "deterministic facts"
 * it assembles are READ from the same shared matchers the ranking uses — they
 * are the ranking's own output, restated for prose, never a second opinion.
 *
 * ## Rule N1, structurally
 *
 * Every read below is a live query against the candidate's current rows.
 * There is no snapshot table, no cached payload and no join to application
 * history: a deleted link contributes nothing because its row is gone, and an
 * edited headline is read as edited because nothing stored the old one. The
 * `fingerprint` this service returns is what extends that guarantee to the
 * cache — see `external-why-match.service.ts`.
 */

/** The professional facts that may travel to a model. Minimized on purpose. */
export interface PremiumCandidateContext {
  headline: string | null;
  summary: string | null;
  locationLabel: string | null;
  skills: string[];
  languages: string[];
  experience: string[];
  education: string[];
  preferences: string[];
  evidenceExcerpts: string[];
}

export interface PremiumJobContext {
  jobId: string;
  title: string;
  company: string | null;
  status: string;
  locationLabel: string | null;
  workMode: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  salaryLabel: string | null;
  skills: string[];
  languages: string[];
  benefits: string[];
  description: string | null;
  requirementsText: string | null;
}

export interface PremiumMatchFacts {
  score: number | null;
  band: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  alignmentNotes: string[];
}

/**
 * One RAW preference-alignment verdict, exactly as the shared matchers
 * returned it. Present only for dimensions the candidate actually stated a
 * preference on — absence of a dimension here IS the fact that no preference
 * exists, and consumers must not fill that silence in.
 *
 * Added for the Advanced Match Breakdown, which needs the unfiltered states
 * (including UNKNOWN) to classify dimensions deterministically. The prose
 * features keep reading `facts.alignmentNotes`, which still drops UNKNOWN.
 */
export interface PremiumAlignment {
  dimension: string;
  state: string;
  reason: string;
}

export interface PremiumAiContext {
  candidateAccountId: string;
  candidate: PremiumCandidateContext;
  job: PremiumJobContext;
  facts: PremiumMatchFacts;
  /** Raw stated-preference verdicts; NOT sent to models by the prose features. */
  alignments: PremiumAlignment[];
  /**
   * Identity of THIS candidate state + THIS job content.
   *
   * Two inputs, hashed together (see `fingerprintOf`). It is what makes a
   * cached answer unreachable the moment either side changes, which is how
   * Rule N1 reaches a cache that has no idea what a candidate is.
   */
  fingerprint: string;
}

/** How much of a link's extracted text may travel. Bounded, not unbounded. */
const MAX_EVIDENCE_EXCERPTS = 6;
const MAX_EXCERPT_CHARS = 500;

@Injectable()
export class ExternalPremiumAiContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: CandidatePreferencesService,
    private readonly fx: FxRateService,
  ) {}

  /**
   * Load everything a premium feature needs about (this candidate, this job).
   *
   * The job is read by id WITHOUT a status filter, deliberately: the saved
   * list and the tracking list legitimately show CLOSED and EXPIRED jobs, and
   * a candidate looking at one of their own saved roles may reasonably ask
   * why it matched them. The lifecycle state travels into the context as a
   * fact, so the answer can acknowledge it instead of describing a dead
   * listing as an opportunity. What this does NOT do is resurrect anything:
   * search and detail keep their own ACTIVE|STALE rules, unchanged.
   */
  async load(userId: string, externalJobId: string): Promise<PremiumAiContext> {
    const candidateAccountId = await this.preferences.requireAccountId(userId);

    const [account, links, documents, job, intent] = await Promise.all([
      this.prisma.candidateAccount.findUniqueOrThrow({
        where: { id: candidateAccountId },
        select: {
          headline: true,
          summary: true,
          location: true,
          skills: true,
          languages: true,
          experience: true,
          education: true,
          // Both revisions matter and they mean different things: the counter
          // moves when files/links change, `updatedAt` when the profile is
          // edited. A fingerprint built on only one of them would serve a
          // stale explanation after the other kind of change.
          evidenceRevision: true,
          updatedAt: true,
        },
      }),
      this.prisma.candidateLink.findMany({
        where: { candidateAccountId, status: 'COMPLETED' },
        select: { title: true, sections: true, updatedAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.document.findMany({
        where: { candidateAccountId, status: 'COMPLETED' },
        select: { originalFileName: true, type: true, updatedAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.externalJob.findUnique({
        where: { id: externalJobId },
        select: {
          id: true,
          title: true,
          status: true,
          countryCode: true,
          region: true,
          city: true,
          workMode: true,
          remoteCountriesAllowed: true,
          employmentType: true,
          seniorityLevel: true,
          salaryMin: true,
          salaryMax: true,
          currency: true,
          payPeriod: true,
          skills: true,
          languageCodes: true,
          benefits: true,
          industries: true,
          description: true,
          requirementsText: true,
          // The universe-revision column: it moves only when a SEARCH-RELEVANT
          // field actually changed, never on a crawler re-observation. Using
          // it as the job half of the fingerprint is what stops a sweep from
          // invalidating every explanation several times a day.
          searchableUpdatedAt: true,
          company: { select: { name: true } },
        },
      }),
      this.preferences.resolveIntent(candidateAccountId),
    ]);

    if (!job) throw new NotFoundException('External job not found');

    const candidate = this.candidateContext(account, links, documents, intent);
    const jobContext = this.jobContext(job);
    const { facts, alignments } = await this.deterministicFacts(
      job,
      intent,
      account.skills,
    );

    return {
      candidateAccountId,
      candidate,
      job: jobContext,
      facts,
      alignments,
      fingerprint: this.fingerprintOf({
        candidateAccountId,
        evidenceRevision: account.evidenceRevision,
        profileUpdatedAt: account.updatedAt,
        // A link re-fetch that changed nothing leaves `updatedAt` alone; one
        // that changed the content moves it, and moves this with it.
        evidenceUpdatedAt: [...links, ...documents]
          .map((row) => row.updatedAt.getTime())
          .reduce((max, value) => Math.max(max, value), 0),
        intentHash: JSON.stringify(intent),
        jobId: job.id,
        jobRevision: job.searchableUpdatedAt,
        jobStatus: job.status,
      }),
    };
  }

  private candidateContext(
    account: {
      headline: string | null;
      summary: string | null;
      location: string | null;
      skills: string[];
      languages: string[];
      experience: unknown;
      education: unknown;
    },
    links: { title: string | null; sections: unknown }[],
    documents: { originalFileName: string; type: string }[],
    intent: CandidateJobIntent,
  ): PremiumCandidateContext {
    return {
      headline: account.headline,
      summary: account.summary,
      locationLabel: account.location,
      skills: account.skills,
      languages: account.languages,
      experience: flattenEntries(account.experience),
      education: flattenEntries(account.education),
      preferences: statedPreferences(intent),
      evidenceExcerpts: evidenceExcerpts(links, documents),
    };
  }

  private jobContext(job: {
    id: string;
    title: string;
    status: string;
    countryCode: string | null;
    region: string | null;
    city: string | null;
    workMode: string | null;
    remoteCountriesAllowed: string[];
    employmentType: string | null;
    seniorityLevel: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string | null;
    payPeriod: string | null;
    skills: string[];
    languageCodes: string[];
    benefits: string[];
    description: string | null;
    requirementsText: string | null;
    company: { name: string } | null;
  }): PremiumJobContext {
    return {
      jobId: job.id,
      title: job.title,
      company: job.company?.name ?? null,
      status: job.status,
      locationLabel: locationLabel(job),
      workMode: job.workMode,
      employmentType: job.employmentType,
      seniorityLevel: job.seniorityLevel,
      // Null when the employer stated nothing — never "not specified" and
      // never 0, both of which read as facts the source never gave.
      salaryLabel: salaryLabel(job),
      skills: job.skills,
      languages: job.languageCodes,
      benefits: job.benefits,
      description: job.description,
      requirementsText: job.requirementsText,
    };
  }

  /**
   * The facts the DETERMINISTIC pipeline already decided, restated.
   *
   * Skill overlap is computed here by set intersection over stored values —
   * arithmetic, not judgement. Preference alignment is delegated to
   * `searchAlignment`, the exact function external search ranks with, so the
   * notes a reader is shown cannot drift from the order they were shown in.
   *
   * `score` and `band` are deliberately left null for a single-job read:
   * an external score is a RANKING position produced against a specific
   * query and universe, and this endpoint has neither. Inventing one here —
   * or recomputing a lone score out of context — would be exactly the
   * "second opinion about ranking" the architecture forbids.
   */
  private async deterministicFacts(
    job: {
      id: string;
      title: string;
      countryCode: string | null;
      region: string | null;
      city: string | null;
      workMode: string | null;
      remoteCountriesAllowed: string[];
      employmentType: string | null;
      seniorityLevel: string | null;
      salaryMin: number | null;
      salaryMax: number | null;
      currency: string | null;
      payPeriod: string | null;
      skills: string[];
      benefits: string[];
      industries: string[];
      company: { name: string } | null;
    },
    intent: CandidateJobIntent,
    candidateSkills: string[],
  ): Promise<{ facts: PremiumMatchFacts; alignments: PremiumAlignment[] }> {
    const normalized = new Map(
      candidateSkills.map((skill) => [skill.trim().toLowerCase(), skill]),
    );
    const matchedSkills: string[] = [];
    const missingSkills: string[] = [];
    for (const skill of job.skills) {
      const key = skill.trim().toLowerCase();
      if (!key) continue;
      if (normalized.has(key)) matchedSkills.push(skill);
      else missingSkills.push(skill);
    }

    const filters: SearchSecondaryFilters = {
      workModes: intent.workModes,
      employmentTypes: intent.employmentTypes,
      seniorityLevels: intent.seniorityLevels,
      compensation: intent.compensation,
      preferredLocations: intent.locations,
    };

    const features: NormalizedJobFeatures = {
      jobId: job.id,
      sourceType: 'EXTERNAL',
      title: job.title,
      organizationName: job.company?.name ?? '',
      country: job.countryCode ? job.countryCode.toUpperCase() : null,
      region: job.region,
      city: job.city,
      workMode: job.workMode as NormalizedJobFeatures['workMode'],
      remoteCountriesAllowed: (job.remoteCountriesAllowed ?? []).map((code) =>
        code.toUpperCase(),
      ),
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      currency: job.currency,
      payPeriod: job.payPeriod as NormalizedJobFeatures['payPeriod'],
      employmentType:
        job.employmentType as NormalizedJobFeatures['employmentType'],
      seniorityLevel:
        job.seniorityLevel as NormalizedJobFeatures['seniorityLevel'],
      benefits: (job.benefits ?? []) as NormalizedJobFeatures['benefits'],
      industries: job.industries ?? [],
    };

    const { table } = await this.fx.current();
    const alignment = searchAlignment(features, filters, table);

    return {
      facts: {
        score: null,
        band: null,
        matchedSkills,
        missingSkills,
        alignmentNotes: alignment.alignments
          // UNKNOWN means the employer said nothing on that dimension.
          // Passing it as a "note" would invite prose describing the
          // employer's silence as a finding about the candidate.
          .filter((entry) => entry.state !== 'UNKNOWN')
          .map(
            (entry) => `${entry.dimension}: ${entry.state} (${entry.reason})`,
          ),
      },
      // Unfiltered: the breakdown's deterministic classifier needs UNKNOWN
      // as a state, and it renders silence as UNKNOWN — never as weakness.
      alignments: alignment.alignments.map((entry) => ({
        dimension: entry.dimension,
        state: entry.state,
        reason: entry.reason,
      })),
    };
  }

  /**
   * The cache identity of (this candidate state, this job content).
   *
   * Everything that can change what a truthful explanation would say goes in;
   * nothing else does. Specifically ABSENT: `lastSeenAt`, `lastVerifiedAt`,
   * `firstSeenAt`, ingestion run ids and the job's own `updatedAt` — all of
   * which move when a crawler re-observes an unchanged posting. Including any
   * of them would throw away every cached explanation several times a day for
   * no reader-visible reason.
   */
  fingerprintOf(input: {
    candidateAccountId: string;
    evidenceRevision: number;
    profileUpdatedAt: Date;
    evidenceUpdatedAt: number;
    intentHash: string;
    jobId: string;
    jobRevision: Date;
    jobStatus: string;
  }): string {
    return createHash('sha256')
      .update(
        [
          input.candidateAccountId,
          `ev:${input.evidenceRevision}`,
          `prof:${input.profileUpdatedAt.getTime()}`,
          `evat:${input.evidenceUpdatedAt}`,
          `intent:${input.intentHash}`,
          input.jobId,
          `job:${input.jobRevision.getTime()}`,
          `status:${input.jobStatus}`,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 32);
  }
}

/* -------------------------------------------------------------------------- */

/** `[{title, company, ...}]` → readable lines. Nothing invented, nothing lost. */
function flattenEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const entry of value.slice(0, 20)) {
    if (typeof entry === 'string') {
      if (entry.trim()) lines.push(entry.trim());
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const parts = [
      'title',
      'role',
      'position',
      'degree',
      'field',
      'company',
      'organization',
      'school',
      'institution',
      'startDate',
      'endDate',
      'period',
    ]
      .map((key) => record[key])
      .filter(
        (part): part is string => typeof part === 'string' && !!part.trim(),
      )
      .map((part) => part.trim());
    if (parts.length) lines.push(parts.join(' · '));
  }
  return lines;
}

/** What the candidate SAID they want. Empty stays empty — never a guess. */
function statedPreferences(intent: CandidateJobIntent): string[] {
  if (!intent.stated) return [];
  const lines: string[] = [];
  const add = (label: string, values: string[]) => {
    if (values.length) lines.push(`${label}: ${values.join(', ')}`);
  };
  add('desired roles', intent.roles ?? []);
  add('preferred work modes', intent.workModes ?? []);
  add('preferred employment types', intent.employmentTypes ?? []);
  add('preferred seniority', intent.seniorityLevels ?? []);
  add(
    'preferred locations',
    (intent.locations ?? []).map((location) =>
      [location.city, location.region, location.countryCode]
        .filter(Boolean)
        .join(', '),
    ),
  );
  if (intent.compensation) {
    const { minAmount, maxAmount, currency, payPeriod } = intent.compensation;
    const range = maxAmount ? `${minAmount}–${maxAmount}` : `${minAmount}+`;
    lines.push(`desired pay: ${range} ${currency} per ${payPeriod}`);
  }
  return lines;
}

/**
 * Short excerpts of the candidate's CURRENT evidence.
 *
 * Links contribute their stored extracted sections (the same text the search
 * index was built from); documents contribute their name and kind, because
 * their extracted text lives in the vector store rather than in Postgres and
 * this path deliberately does not reach into retrieval. A deleted source
 * contributes nothing — its row is gone, which is Rule N1 by construction.
 */
function evidenceExcerpts(
  links: { title: string | null; sections: unknown }[],
  documents: { originalFileName: string; type: string }[],
): string[] {
  const out: string[] = [];
  for (const document of documents) {
    out.push(`${document.type}: ${document.originalFileName}`);
    if (out.length >= MAX_EVIDENCE_EXCERPTS) return out;
  }
  for (const link of links) {
    const sections = Array.isArray(link.sections) ? link.sections : [];
    const text = sections
      .map((section) => {
        if (!section || typeof section !== 'object') return '';
        const value = (section as Record<string, unknown>).text;
        // Only genuine strings travel. A nested object would otherwise
        // stringify to "[object Object]" and become a fabricated fact.
        return typeof value === 'string' ? value : '';
      })
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const label = link.title?.trim() || 'Linked page';
    out.push(`${label}: ${text.slice(0, MAX_EXCERPT_CHARS)}`);
    if (out.length >= MAX_EVIDENCE_EXCERPTS) return out;
  }
  return out;
}

function locationLabel(job: {
  city: string | null;
  region: string | null;
  countryCode: string | null;
  workMode: string | null;
  remoteCountriesAllowed: string[];
}): string | null {
  const place = [job.city, job.region, job.countryCode]
    .filter((part): part is string => !!part)
    .join(', ');
  if (job.workMode === 'REMOTE') {
    // Stated remote geography, or silence. Never "worldwide": no source said
    // that, and remote work is bounded by law and payroll.
    const allowed = job.remoteCountriesAllowed ?? [];
    if (allowed.length) return `Remote (${allowed.join(', ')})`;
    return place || null;
  }
  return place || null;
}

function salaryLabel(job: {
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: string | null;
}): string | null {
  if (job.salaryMin === null && job.salaryMax === null) return null;
  const amount =
    job.salaryMin !== null && job.salaryMax !== null
      ? `${job.salaryMin}–${job.salaryMax}`
      : `${job.salaryMin ?? job.salaryMax}`;
  return [amount, job.currency, job.payPeriod ? `per ${job.payPeriod}` : null]
    .filter(Boolean)
    .join(' ');
}
