import type {
  EmploymentType,
  SeniorityLevel,
  WorkMode,
} from '../generated/prisma/enums';
import type {
  CandidateJobIntent,
  JobIntentCompensation,
  JobIntentExclusions,
} from './candidate-job-intent';

/**
 * What the candidate asked for IN THIS REQUEST.
 *
 * Completely separate from their saved preferences, and never written back to
 * them: typing "Berlin" into a search box is not a decision to move to
 * Germany. Conflating the two is how a job platform starts quietly rewriting
 * what a person said they want.
 */
export interface ExplicitJobSearchFilters {
  query?: string | null;
  /** ISO 3166-1 alpha-2. */
  countries?: string[];
  workModes?: WorkMode[];
  employmentTypes?: EmploymentType[];
  seniorityLevels?: SeniorityLevel[];
  minCompensation?: JobIntentCompensation | null;
}

/**
 * Where a dimension's value came from — the thing an explanation needs.
 *
 * UNSPECIFIED means NO RESTRICTION on that dimension. It does not mean "reject
 * everything", and a consumer that reads it that way turns a candidate who
 * said nothing into a candidate who is shown nothing.
 */
export type JobIntentSource = 'REQUEST' | 'PREFERENCE' | 'UNSPECIFIED';

export interface ResolvedDimension<T> {
  value: T;
  source: JobIntentSource;
}

/**
 * One search's effective intent, dimension by dimension, each labelled with
 * where it came from.
 *
 * This is a DESCRIPTION, not a filter. Task 2 deliberately stops here: nothing
 * in this object is applied to a query or a score yet. Task 3 decides which
 * dimensions become hard constraints, which become ranking boosts and which
 * become soft mismatches — and the `source` label is what will let it say
 * "filtered because you searched Berlin" versus "ranked lower because your
 * saved preference is Seoul".
 */
export interface ResolvedJobSearchIntent {
  query: ResolvedDimension<string | null>;
  roles: ResolvedDimension<string[]>;
  countries: ResolvedDimension<string[]>;
  workModes: ResolvedDimension<WorkMode[]>;
  employmentTypes: ResolvedDimension<EmploymentType[]>;
  seniorityLevels: ResolvedDimension<SeniorityLevel[]>;
  compensation: ResolvedDimension<JobIntentCompensation | null>;
  /**
   * Always the candidate's SAVED exclusions — there is no request-level way to
   * exclude, and an ad-hoc search must not be able to silently drop them.
   */
  exclusions: JobIntentExclusions;
}

/** Everything a candidate→jobs search needs to know about who is asking. */
export interface JobSearchContext {
  candidateAccountId: string;
  /** The candidate's saved intent, untouched by this request. */
  jobIntent: CandidateJobIntent;
  /** What this request asked for, untouched by the saved intent. */
  explicit: ExplicitJobSearchFilters;
  /** The two combined by precedence, for this request only. */
  resolved: ResolvedJobSearchIntent;
  locale: string;
}

/** A non-empty explicit list wins; otherwise the saved one; otherwise nothing. */
function pick<T>(
  explicit: T[] | undefined,
  saved: T[],
): ResolvedDimension<T[]> {
  if (explicit && explicit.length > 0) {
    return { value: explicit, source: 'REQUEST' };
  }
  if (saved.length > 0) return { value: saved, source: 'PREFERENCE' };
  return { value: [], source: 'UNSPECIFIED' };
}

/**
 * Combines a saved intent with one request's filters.
 *
 * ## The precedence rule
 *
 *     explicit request filter  →  saved preference  →  no restriction
 *
 * Per dimension, independently. A candidate whose saved country is KR and who
 * searches "Berlin" gets `countries: { value: ['DE'], source: 'REQUEST' }` —
 * Berlin is NOT rejected for disagreeing with the saved default. Their saved
 * work-mode preference still applies, because they did not override that one.
 *
 * This function is pure and changes nothing: the saved preferences are read,
 * never written. Running a search is not a preference update.
 */
export function resolveJobSearchIntent(
  intent: CandidateJobIntent,
  explicit: ExplicitJobSearchFilters = {},
): ResolvedJobSearchIntent {
  const query = explicit.query?.trim();

  return {
    // A search box is request-only: there is no saved "default query", because
    // a saved role preference is a role, not a phrase to search for.
    query: query
      ? { value: query, source: 'REQUEST' }
      : { value: null, source: 'UNSPECIFIED' },
    roles:
      intent.roles.length > 0
        ? { value: intent.roles, source: 'PREFERENCE' }
        : { value: [], source: 'UNSPECIFIED' },
    countries: pick(explicit.countries, intent.countries),
    workModes: pick(explicit.workModes, intent.workModes),
    employmentTypes: pick(explicit.employmentTypes, intent.employmentTypes),
    seniorityLevels: pick(explicit.seniorityLevels, intent.seniorityLevels),
    compensation: explicit.minCompensation
      ? { value: explicit.minCompensation, source: 'REQUEST' }
      : intent.compensation
        ? { value: intent.compensation, source: 'PREFERENCE' }
        : { value: null, source: 'UNSPECIFIED' },
    exclusions: intent.exclusions,
  };
}

export function buildJobSearchContext(
  intent: CandidateJobIntent,
  explicit: ExplicitJobSearchFilters,
  locale: string,
): JobSearchContext {
  return {
    candidateAccountId: intent.candidateAccountId,
    jobIntent: intent,
    explicit,
    resolved: resolveJobSearchIntent(intent, explicit),
    locale,
  };
}
