import type {
  EmploymentType,
  JobBenefit,
  PayPeriod,
  SeniorityLevel,
  WorkMode,
} from '../generated/prisma/enums';

/**
 * ONE canonical description of what a candidate is looking for.
 *
 * This is the shape every candidate→jobs surface reads — Find Jobs, AI Job
 * Match, and every future external provider search. They consume THIS, never
 * the preference tables, so there is one interpretation of a candidate's
 * intent instead of one per feature that quietly disagree.
 *
 * It is also the reason internal and external jobs can share a pipeline: the
 * intent is expressed in the same vocabulary a job is (ISO country codes,
 * WorkMode, SeniorityLevel, PayPeriod, currency, JobBenefit), so a Greenhouse
 * or Ninehire job that normalizes into those values is comparable with an
 * internal vacancy without either side knowing where the other came from.
 * There is deliberately no internal/external split: a candidate has one intent.
 *
 * ## Reading an empty intent
 *
 * `stated: false` means the candidate has no preference record at all. Every
 * list being empty means the SAME thing per dimension: "nothing stated". It
 * never means "rejects everything", and a consumer that treats an empty
 * `workModes` as an exclusion filter has misread this contract. Likewise
 * `compensation: null` is "named no threshold", not a floor of zero, and
 * `relocation: null` is "did not say", not false.
 */
export interface JobIntentLocation {
  /** ISO 3166-1 alpha-2, uppercase — the only canonical part. */
  countryCode: string;
  /** Normalized user text, NOT geocoded. */
  region: string | null;
  city: string | null;
}

/** A floor the candidate stated, with the units that make it meaningful. */
export interface JobIntentCompensation {
  minAmount: number;
  /**
   * The top of the range they named, or null when they stated only a floor.
   *
   * A TARGET rather than a ceiling: a job paying above it is still a match.
   * The distinction matters — reading this as a limit would hide better-paying
   * work from someone who never asked for that.
   */
  maxAmount: number | null;
  /** ISO-4217 alpha-3. */
  currency: string;
  payPeriod: PayPeriod;
}

export interface JobIntentExclusions {
  companies: string[];
  jobTitles: string[];
  locations: JobIntentLocation[];
}

export interface CandidateJobIntent {
  candidateAccountId: string;
  /**
   * Whether a preference record exists at all. Lets a consumer distinguish
   * "this candidate has never told us anything" from "this candidate cleared
   * every field", which look identical field by field but are different
   * product situations (one warrants a prompt to set preferences).
   */
  stated: boolean;

  /** Desired ROLES — never skills, never derived from a resume. */
  roles: string[];
  locations: JobIntentLocation[];
  /**
   * Country codes appearing in `locations`, de-duplicated — a convenience
   * projection for consumers that only filter at country granularity. Derived,
   * never separately stored, so it cannot drift from `locations`.
   */
  countries: string[];

  workModes: WorkMode[];
  compensation: JobIntentCompensation | null;
  employmentTypes: EmploymentType[];
  seniorityLevels: SeniorityLevel[];
  /** Tri-state; null is "not stated" and is never inferred from `locations`. */
  relocation: boolean | null;

  preferredIndustries: string[];
  preferredBenefits: JobBenefit[];

  exclusions: JobIntentExclusions;

  /** When the candidate last stated any of this; null when never. */
  updatedAt: string | null;
}

/**
 * The intent of a candidate who has stated nothing.
 *
 * Every consumer gets a well-formed object rather than null, so "no
 * preferences" cannot become an unhandled branch that accidentally filters
 * everything out.
 */
export function emptyJobIntent(candidateAccountId: string): CandidateJobIntent {
  return {
    candidateAccountId,
    stated: false,
    roles: [],
    locations: [],
    countries: [],
    workModes: [],
    compensation: null,
    employmentTypes: [],
    seniorityLevels: [],
    relocation: null,
    preferredIndustries: [],
    preferredBenefits: [],
    exclusions: { companies: [], jobTitles: [], locations: [] },
    updatedAt: null,
  };
}

/**
 * Whether the candidate has actually expressed anything a search could act on.
 *
 * `stated` says a record exists; this says the record is not blank. A candidate
 * who created preferences and then cleared every field has `stated: true` and
 * `hasAnyIntent: false`, and no search should behave as if they had constrained
 * anything.
 */
export function hasAnyIntent(intent: CandidateJobIntent): boolean {
  return (
    intent.roles.length > 0 ||
    intent.locations.length > 0 ||
    intent.workModes.length > 0 ||
    intent.compensation !== null ||
    intent.employmentTypes.length > 0 ||
    intent.seniorityLevels.length > 0 ||
    intent.relocation !== null ||
    intent.preferredIndustries.length > 0 ||
    intent.preferredBenefits.length > 0 ||
    intent.exclusions.companies.length > 0 ||
    intent.exclusions.jobTitles.length > 0 ||
    intent.exclusions.locations.length > 0
  );
}

/** A place as one comparable key — used for de-duplication, never for display. */
export function locationKey(location: JobIntentLocation): string {
  return [
    location.countryCode.toUpperCase(),
    (location.region ?? '').trim().toLowerCase(),
    (location.city ?? '').trim().toLowerCase(),
  ].join('|');
}
