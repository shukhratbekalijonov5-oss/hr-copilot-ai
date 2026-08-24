import type { CandidateJobIntent } from '../candidate-preferences/candidate-job-intent';
import type { NormalizedJobFeatures } from './normalized-job-features';
import { normalizeTitle } from './intent-alignment';

/**
 * The ONLY things that remove a job from a candidate's rankable universe.
 *
 * The product rule this file enforces: LOW MATCH ≠ HIDDEN JOB. A vacancy that
 * survives these checks stays in the ranked results however badly it scores —
 * a 0/100 job is still listed, on the last page. What removes a job is the
 * candidate's own EXPLICIT exclusion, or a strict filter the candidate typed
 * into the current request. Saved positive preferences (preferred city,
 * preferred work mode, salary floor…) never reach this file; they are soft
 * ranking signals in `intent-alignment.ts`.
 *
 * Matching here is deliberately conservative — exact normalized equality, no
 * fuzz. "ABC Corp" excludes ABC Corp's vacancies and does not touch
 * "ABC Corporation": over-excluding on a similar name silently hides jobs the
 * candidate never asked to lose, and there is no UI where they would find out.
 * UNKNOWN can never trigger an exclusion: a vacancy with no structured
 * location cannot match an excluded place, so it stays.
 */
export type HardExclusionReason =
  | 'EXCLUDED_COMPANY'
  | 'EXCLUDED_TITLE'
  | 'EXCLUDED_LOCATION'
  | 'REQUEST_COUNTRY_FILTER';

export type EligibilityState = 'ELIGIBLE' | 'HARD_EXCLUDED';

export interface HardConstraintResult {
  eligibility: EligibilityState;
  reason: HardExclusionReason | null;
}

export interface HardConstraintOptions {
  /**
   * Countries from an EXPLICIT current search request in strict mode — the
   * one case where a location removes jobs, and it lives only for that
   * request. AI Job Match (a recommendation, not a search) passes none, and
   * a candidate's SAVED countries are never fed through this: saved
   * preferences rank, they do not filter.
   */
  strictCountries?: string[];
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sameText(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function evaluateHardConstraints(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
  options: HardConstraintOptions = {},
): HardConstraintResult {
  const company = normalizeName(features.organizationName);
  for (const excluded of intent.exclusions.companies) {
    if (normalizeName(excluded) === company) {
      return { eligibility: 'HARD_EXCLUDED', reason: 'EXCLUDED_COMPANY' };
    }
  }

  const title = normalizeTitle(features.title);
  for (const excluded of intent.exclusions.jobTitles) {
    if (normalizeTitle(excluded) === title) {
      return { eligibility: 'HARD_EXCLUDED', reason: 'EXCLUDED_TITLE' };
    }
  }

  // An excluded place removes a vacancy only when the vacancy CONFIDENTLY
  // sits inside it: country must match, and any region/city the candidate
  // narrowed the exclusion to must match too. An exclusion of KR/Seoul does
  // not remove a KR vacancy whose city is unknown — maybe it is Seoul, maybe
  // Busan, and "maybe" never excludes.
  if (features.country !== null) {
    for (const excluded of intent.exclusions.locations) {
      if (features.country !== excluded.countryCode.toUpperCase()) continue;
      if (excluded.region && !sameText(features.region, excluded.region)) {
        continue;
      }
      if (excluded.city && !sameText(features.city, excluded.city)) continue;
      return { eligibility: 'HARD_EXCLUDED', reason: 'EXCLUDED_LOCATION' };
    }
  }

  const strict = options.strictCountries ?? [];
  if (strict.length > 0) {
    const wanted = strict.map((code) => code.toUpperCase());
    const inCountry =
      features.country !== null && wanted.includes(features.country);
    const remoteEligible =
      features.workMode === 'REMOTE' &&
      features.remoteCountriesAllowed.some((code) => wanted.includes(code));
    if (!inCountry && !remoteEligible) {
      return { eligibility: 'HARD_EXCLUDED', reason: 'REQUEST_COUNTRY_FILTER' };
    }
  }

  return { eligibility: 'ELIGIBLE', reason: null };
}

export interface HardConstraintPartition {
  eligible: NormalizedJobFeatures[];
  excluded: { vacancyId: string; reason: HardExclusionReason }[];
}

/** Splits a universe into the rankable set and the explicitly-removed set. */
export function partitionByHardConstraints(
  universe: NormalizedJobFeatures[],
  intent: CandidateJobIntent,
  options: HardConstraintOptions = {},
): HardConstraintPartition {
  const eligible: NormalizedJobFeatures[] = [];
  const excluded: HardConstraintPartition['excluded'] = [];
  for (const features of universe) {
    const result = evaluateHardConstraints(features, intent, options);
    if (result.eligibility === 'ELIGIBLE') {
      eligible.push(features);
    } else {
      excluded.push({
        vacancyId: features.jobId,
        reason: result.reason as HardExclusionReason,
      });
    }
  }
  return { eligible, excluded };
}
