import type { RateTable } from '../fx/money';
import { emptyJobIntent } from '../candidate-preferences/candidate-job-intent';
import type {
  CandidateJobIntent,
  JobIntentCompensation,
  JobIntentLocation,
} from '../candidate-preferences/candidate-job-intent';
import type {
  EmploymentType,
  SeniorityLevel,
  WorkMode,
} from '../generated/prisma/enums';
import type { NormalizedJobFeatures } from './normalized-job-features';
import {
  alignEmployment,
  alignLocation,
  alignSalary,
  alignSeniority,
  alignWorkMode,
  type IntentAlignment,
} from './intent-alignment';
import { INTENT_DIMENSION_WEIGHTS } from './match-policy';

/**
 * Find Jobs: the SOFT half of a search.
 *
 * ## The rule this file exists to enforce
 *
 * The primary text query decides WHICH jobs exist in a search; an explicitly
 * chosen location narrows that universe; everything else only decides the
 * ORDER. Work arrangement, employment type, experience level and pay are
 * ranking preferences, not filters — selecting "Remote" must never delete the
 * hybrid and on-site jobs that answer the same search.
 *
 * The failure mode being prevented is concrete and common: a candidate
 * searches "Backend Engineer", ticks Remote, Full-time, Senior and a salary
 * floor, and every one of those becomes an `AND` in a SQL query. Six
 * reasonable choices intersect down to two results — or none — and the person
 * concludes the company has no backend roles when it has thirty. Narrowing
 * their own search is a decision only they should be able to make, and the UI
 * offers no strict mode, so the backend must not invent one.
 *
 * ## Why it delegates every comparison
 *
 * Nothing here decides whether a job's work mode, employment type, seniority
 * or salary matches. Those verdicts come from the SAME deterministic matchers
 * that rank AI Job Match (`intent-alignment.ts`), through the same weights
 * (`match-policy.ts`), so a job cannot be judged "senior enough" on one screen
 * and not on the other. A second seniority ladder or a second currency
 * conversion is exactly the kind of drift that makes two surfaces disagree
 * about the same job, so there is only one of each in the product.
 */

/**
 * The soft dimensions of one search.
 *
 * Every field is "not stated" when empty, and an unstated dimension simply
 * drops out of the score — never restricting, never penalizing. A candidate
 * who ticks nothing gets the catalogue's own order back.
 */
export interface SearchSecondaryFilters {
  workModes: WorkMode[];
  employmentTypes: EmploymentType[];
  seniorityLevels: SeniorityLevel[];
  /** A pay floor (and optional target), in the candidate's chosen currency. */
  compensation: JobIntentCompensation | null;
  /**
   * A SAVED location preference — soft, and deliberately separate from the
   * explicit `countries` request filter.
   *
   * Someone whose profile says Seoul who types "Backend Engineer" is asking
   * about backend engineering, not about Seoul. Their saved city is a good
   * reason to show Seoul roles FIRST and no reason at all to hide Toronto.
   * The hard filter is only ever the location they picked for THIS search.
   */
  preferredLocations: JobIntentLocation[];
}

export interface SearchAlignment {
  /**
   * 0–100 over what the search ASKED — or null when it asked nothing soft.
   *
   * Null and 0 differ: null is "no soft preference was stated", which leaves
   * the catalogue's own order alone; 0 is "this job answers none of what was
   * asked" — which still leaves it in the list, further down. See
   * `searchScoreFrom` for how an unstated dimension is treated.
   */
  score: number | null;
  alignments: IntentAlignment[];
}

export function hasSecondaryPreferences(
  filters: SearchSecondaryFilters,
): boolean {
  return (
    filters.workModes.length > 0 ||
    filters.employmentTypes.length > 0 ||
    filters.seniorityLevels.length > 0 ||
    filters.preferredLocations.length > 0 ||
    filters.compensation !== null
  );
}

/**
 * The soft filters, expressed as the intent the shared matchers already read.
 *
 * An adapter, not a translation: the matchers take a `CandidateJobIntent`, and
 * a search IS an intent — a temporary one the candidate typed instead of saved.
 * Building it here is what lets Find Jobs reuse the ranking logic instead of
 * growing a parallel copy that slowly disagrees with it.
 */
function asIntent(filters: SearchSecondaryFilters): CandidateJobIntent {
  return {
    // Built from the canonical empty intent so a dimension added to that
    // contract cannot silently arrive here as `undefined`.
    ...emptyJobIntent(''),
    stated: true,
    locations: filters.preferredLocations,
    countries: [
      ...new Set(filters.preferredLocations.map((l) => l.countryCode)),
    ],
    workModes: filters.workModes,
    employmentTypes: filters.employmentTypes,
    seniorityLevels: filters.seniorityLevels,
    compensation: filters.compensation,
  };
}

/**
 * How well ONE job answers the soft half of a search.
 *
 * Only stated dimensions are measured. A job the employer left silent on
 * (`workMode: null`, no salary) yields UNKNOWN, which scores null and drops
 * out of the average entirely — an employer's silence must not cost a job its
 * place, because that would rank posting quality instead of job relevance.
 */
export function searchAlignment(
  features: NormalizedJobFeatures,
  filters: SearchSecondaryFilters,
  table: RateTable | null = null,
): SearchAlignment {
  const intent = asIntent(filters);
  const alignments: IntentAlignment[] = [];

  if (filters.preferredLocations.length > 0) {
    alignments.push(alignLocation(features, intent));
  }
  if (filters.workModes.length > 0) {
    alignments.push(alignWorkMode(features, intent));
  }
  if (filters.employmentTypes.length > 0) {
    alignments.push(alignEmployment(features, intent));
  }
  if (filters.seniorityLevels.length > 0) {
    alignments.push(alignSeniority(features, intent));
  }
  if (filters.compensation) {
    alignments.push(alignSalary(features, intent, table));
  }

  return { score: searchScoreFrom(alignments), alignments };
}

/**
 * 0–100 over everything the search ASKED, not everything it could measure.
 *
 * ## Why this is not `intentScoreFrom`
 *
 * The comparisons are shared with AI Job Match; only this last step differs,
 * and deliberately. There, an UNKNOWN dimension drops out of the average
 * entirely, which is right because capability carries 80% of that score —
 * intent is an adjustment, and an employer's silence should not move it.
 *
 * Find Jobs has no capability term. Alignment IS the order. Dropping unknowns
 * there produces a result nobody wants: a job whose employer stated nothing
 * but the employment type answers one of four questions perfectly, scores
 * 100%, and ties a job that genuinely answered all four. The reader is then
 * shown the least informative posting first.
 *
 * So an unstated dimension keeps its WEIGHT and earns the neutral half. Three
 * tiers fall out, and they are the honest information ordering:
 *
 *   this job matches what you asked      1.0   ranks first
 *   nobody said whether it does          0.5   ranks between
 *   this job contradicts what you asked  0.0   ranks last
 *
 * Scoring an unknown as 0 was the first attempt and it was wrong twice over: a
 * job silent on everything but employment type tied one that answered all four
 * dimensions, and — worse — a job that said nothing about work mode ranked
 * exactly level with one that is definitively on-site. The product tells the
 * candidate those are different things ("the employer did not say" is not "this
 * does not match"), so the order has to agree.
 *
 * None of this is a penalty for silence in the sense the product forbids: an
 * unknown never removes a job, never becomes a mismatch, and never reads back
 * as anything but an absence.
 */
const UNKNOWN_CREDIT = 0.5;

export function searchScoreFrom(alignments: IntentAlignment[]): number | null {
  let asked = 0;
  let earned = 0;
  for (const alignment of alignments) {
    const weight = INTENT_DIMENSION_WEIGHTS[alignment.dimension];
    asked += weight;
    earned +=
      weight * (alignment.score === null ? UNKNOWN_CREDIT : alignment.score);
  }
  if (asked === 0) return null;
  return Math.round((earned / asked) * 100);
}

/**
 * The order of a search's results.
 *
 * Alignment first, then the catalogue's own recency, then the slug. The last
 * two are not decoration: pagination slices this list, so two jobs with equal
 * alignment must compare identically on every request or a reader paging
 * forward can see the same job twice and never see another. `null` alignment
 * sorts as -1 — below a measured zero — which only matters when some jobs were
 * comparable and others were not, and even then it decides order alone.
 */
export interface RankableSearchResult {
  score: number | null;
  createdAt: Date;
  publicSlug: string;
}

export function compareSearchResults(
  a: RankableSearchResult,
  b: RankableSearchResult,
): number {
  const aScore = a.score ?? -1;
  const bScore = b.score ?? -1;
  if (aScore !== bScore) return bScore - aScore;
  const aTime = a.createdAt.getTime();
  const bTime = b.createdAt.getTime();
  if (aTime !== bTime) return bTime - aTime;
  return a.publicSlug < b.publicSlug ? -1 : a.publicSlug > b.publicSlug ? 1 : 0;
}
