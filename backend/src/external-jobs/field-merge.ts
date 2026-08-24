import type {
  ExternalJobLocation,
  NormalizedExternalJobInput,
  PostingDateSemantics,
} from './external-job.contract';
import { sourceTrust } from './external-job.limits';
import type { Prisma } from '../generated/prisma/client';

/**
 * Which source's answer wins when two disagree.
 *
 * The situation is routine: an ATS says 40–50M KRW, an aggregator says nothing,
 * the company's own page says 45–55M. Three rules, applied in order, and the
 * order is the whole design:
 *
 *  1. A STATED fact beats silence. Always, regardless of trust. A high-trust
 *     source that omitted salary has not contradicted a low-trust source that
 *     published one — it just did not mention it, and treating silence as an
 *     answer would erase real information.
 *  2. Between two stated facts, the more trusted source wins — meaning the one
 *     closer to the employer, not the one that looks nicer.
 *  3. Between equals, the freshest observation wins, because postings are
 *     edited and the later reading is the current one.
 *
 * Nothing is ever silently overwritten without provenance: the losing claim
 * stays on its own `ExternalJobSource` row, so "the board says something else"
 * is answerable rather than lost.
 */

export interface FieldCandidate<T> {
  value: T | null;
  provider: string;
  observedAt: Date;
}

/**
 * The winning value for one field.
 *
 * Returns null only when every candidate was silent — which stays UNKNOWN
 * downstream and is a real answer, not a missing one.
 */
export function resolveField<T>(candidates: FieldCandidate<T>[]): {
  value: T | null;
  provider: string | null;
} {
  const stated = candidates.filter(
    (candidate) =>
      candidate.value !== null &&
      candidate.value !== undefined &&
      !(Array.isArray(candidate.value) && candidate.value.length === 0),
  );
  if (stated.length === 0) return { value: null, provider: null };

  const best = stated.reduce((winner, candidate) => {
    const byTrust =
      sourceTrust(candidate.provider) - sourceTrust(winner.provider);
    if (byTrust !== 0) return byTrust > 0 ? candidate : winner;
    return candidate.observedAt > winner.observedAt ? candidate : winner;
  });
  return { value: best.value, provider: best.provider };
}

/**
 * Salary is resolved as ONE unit, never field by field.
 *
 * Taking the min from the source that published the highest floor and the
 * currency from whichever happened to be more trusted produces a number no
 * employer ever wrote — "40,000,000 USD" is a plausible way to get there. The
 * amounts, the currency and the period are one statement and travel together.
 */
export interface SalaryClaim {
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: string | null;
  provider: string;
  observedAt: Date;
}

export function resolveSalary(claims: SalaryClaim[]): SalaryClaim | null {
  // A claim only counts when it is complete enough to compare: an amount with
  // no currency is a number, not a salary.
  const usable = claims.filter(
    (claim) =>
      claim.salaryMin !== null && claim.currency !== null && claim.payPeriod,
  );
  if (usable.length === 0) return null;
  return usable.reduce((winner, claim) => {
    const byTrust = sourceTrust(claim.provider) - sourceTrust(winner.provider);
    if (byTrust !== 0) return byTrust > 0 ? claim : winner;
    return claim.observedAt > winner.observedAt ? claim : winner;
  });
}

/**
 * The employer's publication date, resolved across sources.
 *
 * ## Why this is its own resolver
 *
 * It follows the same three rules as every other field — stated beats
 * silence, then trust, then freshness — but it must resolve the timestamp and
 * its SEMANTICS together. Greenhouse states the first publication, Ashby the
 * most recent one, schema.org neither in particular; picking the date from one
 * source and the label from another would produce a claim no source made,
 * which is exactly the failure `resolveSalary` exists to prevent for money.
 *
 * ## What it deliberately does not do
 *
 * It does not take the earliest, the latest or the average of disagreeing
 * sources. Those are all ways of inventing a date, and they would each be
 * wrong in a different direction: the earliest understates a genuinely
 * republished listing, the latest makes an old requisition look fresh, and an
 * average is a moment nobody published anything. One source wins, by the
 * project's existing conflict policy, and the losing claim stays on its own
 * row where an audit can find it.
 *
 * ## Disagreement, in practice
 *
 * Two sources for one canonical job is already rare (the live catalogue has
 * zero cross-provider merges), and two that both state a publication date
 * rarer still. When it happens, trust decides — which means the employer's own
 * careers page outranks the ATS behind it, and an ATS outranks an aggregator.
 * That is the right direction: a company republishing on its own site is the
 * employer speaking most directly about its own listing.
 */
export interface PostedClaim {
  posted: StoredEmployerPosted | null;
  provider: string;
  observedAt: Date;
}

export function resolveEmployerPosted(claims: PostedClaim[]): {
  posted: StoredEmployerPosted | null;
  provider: string | null;
} {
  const stated = claims.filter(
    (claim): claim is PostedClaim & { posted: StoredEmployerPosted } =>
      Boolean(claim.posted?.at),
  );
  if (stated.length === 0) return { posted: null, provider: null };

  const best = stated.reduce((winner, claim) => {
    const byTrust = sourceTrust(claim.provider) - sourceTrust(winner.provider);
    if (byTrust !== 0) return byTrust > 0 ? claim : winner;
    return claim.observedAt > winner.observedAt ? claim : winner;
  });
  return { posted: best.posted, provider: best.provider };
}

/**
 * The URL a candidate is sent to in order to apply.
 *
 * Highest trust wins, and within a source the apply/detail URL beats the
 * listing URL. This is the one place source trust genuinely matters to a
 * person: sending someone to an aggregator's mirror of a posting, when the
 * employer's own application form exists, costs them the application.
 */
export function chooseCanonicalUrl(
  sources: {
    provider: string;
    sourceUrl: string;
    originalUrl: string | null;
    observedAt: Date;
  }[],
): { url: string; provider: string } | null {
  if (sources.length === 0) return null;
  const best = sources.reduce((winner, source) => {
    const byTrust = sourceTrust(source.provider) - sourceTrust(winner.provider);
    if (byTrust !== 0) return byTrust > 0 ? source : winner;
    return source.observedAt > winner.observedAt ? source : winner;
  });
  return { url: best.originalUrl ?? best.sourceUrl, provider: best.provider };
}

/** Every field claim one sighting makes, ready for resolution. */
export function claimsFrom(
  input: NormalizedExternalJobInput,
  observedAt: Date,
): {
  provider: string;
  observedAt: Date;
  input: NormalizedExternalJobInput;
} {
  return { provider: input.provider, observedAt, input };
}

// ---------------------------------------------------------------------------
// Stored claims
// ---------------------------------------------------------------------------

/**
 * The facts one source stated, as stored on its `ExternalJobSource` row.
 *
 * A projection of `NormalizedExternalJobInput`, not the whole thing: identity
 * and provenance (provider, source ids, URLs) already live in real columns, so
 * repeating them here would create a second copy that can disagree with the
 * first. What is left is exactly the set of fields two sources can contradict
 * each other about.
 */
/**
 * One source's publication claim, as it survives JSON.
 *
 * `Date` does not round-trip through a JSONB column — it comes back a string —
 * so the stored form says so in the type rather than lying about it and
 * failing at the first `.getTime()`. The timestamp and its semantics stay one
 * object for the same reason salary does: a resolver must never be able to
 * take the instant from one source and the meaning from another.
 */
export interface StoredEmployerPosted {
  /** ISO 8601, UTC. */
  at: string;
  semantics: PostingDateSemantics;
}

export type SourceClaims = Pick<
  NormalizedExternalJobInput,
  | 'title'
  | 'description'
  | 'requirementsText'
  | 'countryCode'
  | 'region'
  | 'city'
  | 'additionalLocations'
  | 'workMode'
  | 'remoteCountriesAllowed'
  | 'employmentType'
  | 'seniorityLevel'
  | 'salaryMin'
  | 'salaryMax'
  | 'currency'
  | 'payPeriod'
  | 'skills'
  | 'industries'
  | 'benefits'
  | 'languageCodes'
  | 'visaSponsorship'
  | 'existingWorkAuthorizationRequired'
  | 'eligibleVisaTypes'
> & {
  /** Null when the source stated no publication date. Absent on old rows. */
  employerPosted?: StoredEmployerPosted | null;
};

export function claimsOf(
  input: NormalizedExternalJobInput,
): Prisma.InputJsonValue {
  const claims: SourceClaims = {
    title: input.title,
    description: input.description,
    requirementsText: input.requirementsText,
    countryCode: input.countryCode,
    region: input.region,
    city: input.city,
    additionalLocations: input.additionalLocations,
    workMode: input.workMode,
    remoteCountriesAllowed: input.remoteCountriesAllowed,
    employmentType: input.employmentType,
    seniorityLevel: input.seniorityLevel,
    salaryMin: input.salaryMin,
    salaryMax: input.salaryMax,
    currency: input.currency,
    payPeriod: input.payPeriod,
    skills: input.skills,
    industries: input.industries,
    benefits: input.benefits,
    languageCodes: input.languageCodes,
    visaSponsorship: input.visaSponsorship,
    existingWorkAuthorizationRequired: input.existingWorkAuthorizationRequired,
    eligibleVisaTypes: input.eligibleVisaTypes,
    employerPosted: input.employerPosted
      ? {
          at: input.employerPosted.at.toISOString(),
          semantics: input.employerPosted.semantics,
        }
      : null,
  };
  return claims as unknown as Prisma.InputJsonValue;
}

/** Whether a stored JSON value is usable as claims. */
export function isClaims(value: unknown): value is SourceClaims {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { title?: unknown }).title === 'string'
  );
}

export interface ClaimingSource {
  provider: string;
  observedAt: Date;
  claims: SourceClaims;
}

/**
 * Every canonical field, resolved from every source that stated something.
 *
 * This is where a company's own careers page and the ATS behind it stop being
 * two rows and become one job's answer. `visaSponsorship` is the one field
 * with a non-null "unknown" — `UNKNOWN` is the schema's default and means the
 * same thing as silence — so it is filtered before resolution rather than
 * being allowed to out-rank a source that actually said YES or NO.
 */
export function resolveClaims(sources: ClaimingSource[]): {
  title: string;
  description: string | null;
  requirementsText: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  additionalLocations: Prisma.InputJsonValue | undefined;
  workMode: SourceClaims['workMode'];
  remoteCountriesAllowed: string[];
  employmentType: SourceClaims['employmentType'];
  seniorityLevel: SourceClaims['seniorityLevel'];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: SourceClaims['payPeriod'];
  skills: string[];
  industries: string[];
  benefits: SourceClaims['benefits'];
  languageCodes: string[];
  visaSponsorship: SourceClaims['visaSponsorship'];
  existingWorkAuthorizationRequired: boolean | null;
  eligibleVisaTypes: string[];
  employerPostedAt: Date | null;
  /** Which provider supplied the winning date, for audit. Not a stored column. */
  employerPostedBy: string | null;
  employerPostedSemantics: PostingDateSemantics | null;
} {
  const pick = <K extends keyof SourceClaims>(
    field: K,
  ): SourceClaims[K] | null =>
    resolveField(
      sources.map((source) => ({
        value: source.claims[field] ?? null,
        provider: source.provider,
        observedAt: source.observedAt,
      })),
    ).value;

  const salary = resolveSalary(
    sources.map((source) => ({
      salaryMin: source.claims.salaryMin ?? null,
      salaryMax: source.claims.salaryMax ?? null,
      currency: source.claims.currency ?? null,
      payPeriod: source.claims.payPeriod ?? null,
      provider: source.provider,
      observedAt: source.observedAt,
    })),
  );

  /*
   * Location travels as a unit, for the reason salary does: a country from one
   * source and a city from another describes a place neither of them meant.
   */
  const place = resolveField<{
    countryCode: string | null;
    region: string | null;
    city: string | null;
    additionalLocations: ExternalJobLocation[];
  }>(
    sources.map((source) => ({
      value:
        source.claims.countryCode || source.claims.city
          ? {
              countryCode: source.claims.countryCode ?? null,
              region: source.claims.region ?? null,
              city: source.claims.city ?? null,
              additionalLocations: source.claims.additionalLocations ?? [],
            }
          : null,
      provider: source.provider,
      observedAt: source.observedAt,
    })),
  ).value;

  const visa = resolveField<SourceClaims['visaSponsorship']>(
    sources.map((source) => ({
      // UNKNOWN is this enum's way of saying nothing, and a source saying
      // nothing must not outrank one that answered.
      value:
        source.claims.visaSponsorship &&
        source.claims.visaSponsorship !== 'UNKNOWN'
          ? source.claims.visaSponsorship
          : null,
      provider: source.provider,
      observedAt: source.observedAt,
    })),
  ).value;

  const posted = resolveEmployerPosted(
    sources.map((source) => ({
      posted: source.claims.employerPosted ?? null,
      provider: source.provider,
      observedAt: source.observedAt,
    })),
  );

  const title = pick('title');
  const additional = place?.additionalLocations ?? [];

  return {
    // A job with no title cannot exist; the freshest claim stands in if the
    // resolver somehow finds none, which only a corrupted row could cause.
    title: title ?? sources[sources.length - 1].claims.title,
    description: pick('description'),
    requirementsText: pick('requirementsText'),
    countryCode: place?.countryCode ?? null,
    region: place?.region ?? null,
    city: place?.city ?? null,
    additionalLocations:
      additional.length > 0
        ? (additional as unknown as Prisma.InputJsonValue)
        : undefined,
    workMode: pick('workMode'),
    remoteCountriesAllowed: pick('remoteCountriesAllowed') ?? [],
    employmentType: pick('employmentType'),
    seniorityLevel: pick('seniorityLevel'),
    salaryMin: salary?.salaryMin ?? null,
    salaryMax: salary?.salaryMax ?? null,
    currency: salary?.currency ?? null,
    payPeriod: (salary?.payPeriod as SourceClaims['payPeriod']) ?? null,
    skills: pick('skills') ?? [],
    industries: pick('industries') ?? [],
    benefits: pick('benefits') ?? [],
    languageCodes: pick('languageCodes') ?? [],
    visaSponsorship: visa ?? 'UNKNOWN',
    existingWorkAuthorizationRequired:
      pick('existingWorkAuthorizationRequired') ?? null,
    eligibleVisaTypes: pick('eligibleVisaTypes') ?? [],
    /*
     * Re-parsed from the stored ISO string. An unparseable value resolves to
     * null rather than to `Invalid Date`, which Postgres would refuse and
     * which would take a whole reconcile down over one bad claim.
     */
    employerPostedAt: parseStoredDate(posted.posted?.at),
    employerPostedBy: posted.provider,
    employerPostedSemantics: posted.posted?.semantics ?? null,
  };
}

function parseStoredDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
