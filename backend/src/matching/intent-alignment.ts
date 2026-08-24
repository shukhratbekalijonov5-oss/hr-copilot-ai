import type { SeniorityLevel } from '../generated/prisma/enums';
import type { CandidateJobIntent } from '../candidate-preferences/candidate-job-intent';
import type { NormalizedJobFeatures } from './normalized-job-features';
import type { RateTable } from '../fx/money';
import { compareSalary, type SalaryComparisonDetail } from './salary-matcher';

/**
 * How one job lines up with what the candidate WANTS — dimension by
 * dimension, deterministically, with machine-readable outcomes.
 *
 * ## Hard vs soft, stated once
 *
 * NOTHING in this file removes a job. Every result here is a soft ranking
 * signal: a mismatch lowers a score, it never hides a vacancy. Removal is the
 * business of `hard-constraints.ts` and happens only on the candidate's own
 * explicit exclusions. The two are separate files so the boundary is a module
 * boundary, not a code path.
 *
 * ## Unknown is neutral
 *
 * A dimension the employer did not state compares as UNKNOWN and carries
 * `score: null`, which excludes it from the intent average entirely — the
 * vacancy is neither rewarded nor punished for silence. The same applies to
 * NOT_COMPARABLE (a salary in a different currency, with no FX to bridge it).
 * Overloading one boolean to mean both "mismatch" and "unknowable" is the
 * exact bug this enum exists to prevent.
 */
export type AlignmentState =
  'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN' | 'NOT_COMPARABLE';

export type IntentDimension =
  | 'role'
  | 'location'
  | 'workMode'
  | 'salary'
  | 'employmentType'
  | 'seniority'
  | 'industries'
  | 'benefits';

export interface IntentAlignment {
  dimension: IntentDimension;
  state: AlignmentState;
  /** Deterministic reason code, e.g. ROLE_EXACT, SALARY_BELOW_MINIMUM. */
  reason: string;
  /**
   * 0..1 contribution to the intent score, or null when the dimension could
   * not be compared (UNKNOWN / NOT_COMPARABLE) — null means "leave me out of
   * the average", never zero.
   */
  score: number | null;
  /**
   * Deterministic numbers behind a salary verdict — the original amounts as
   * the employer stated them and, when a conversion happened, the same money
   * in the candidate's currency. Presentation only: it never affects `score`,
   * and it is stored with the ranking so the figure a candidate reads is the
   * one the ranking actually used.
   */
  salary?: SalaryComparisonDetail;
}

/**
 * Title markers per role family, for INTENT alignment only.
 *
 * Deliberately a mirror of the `titles` lists in the ai-service's
 * ROLE_FAMILIES (app/candidate/capability.py) so the two sides of the product
 * classify a title the same way. It cannot be imported across the language
 * boundary, so: if a marker is added there, add it here. The skills half of
 * that table is NOT mirrored — inferring a family from skills is capability
 * logic (what the evidence shows), while this compares two TITLES (what the
 * candidate asked for vs what the job is called).
 */
const ROLE_FAMILY_TITLES: Record<string, readonly string[]> = {
  frontend: [
    'frontend',
    'front-end',
    'front end',
    'ui engineer',
    'web developer',
    'react developer',
    'next.js developer',
    'javascript developer',
    'ui developer',
    'web engineer',
  ],
  backend: [
    'backend',
    'back-end',
    'back end',
    'api developer',
    'api engineer',
    'server engineer',
    'node.js developer',
    'python developer',
    'java developer',
    'golang developer',
    'platform engineer',
  ],
  fullstack: [
    'full stack',
    'fullstack',
    'full-stack',
    'software engineer',
    'software developer',
    'web application developer',
  ],
  mobile: [
    'mobile',
    'android developer',
    'ios developer',
    'react native developer',
    'flutter developer',
  ],
  devops: [
    'devops',
    'sre',
    'site reliability',
    'infrastructure engineer',
    'cloud engineer',
    'platform engineer',
  ],
  data: [
    'data engineer',
    'data scientist',
    'machine learning',
    'ml engineer',
    'analytics engineer',
  ],
};

/** Adjacent family pairs share real ground; mirrors ranking.py. */
const ADJACENT_FAMILIES: ReadonlySet<string> = new Set(
  [
    ['frontend', 'fullstack'],
    ['backend', 'fullstack'],
    ['backend', 'devops'],
    ['backend', 'data'],
    ['frontend', 'mobile'],
    ['fullstack', 'mobile'],
  ].map((pair) => [...pair].sort().join('|')),
);

/** Case/punctuation-insensitive canonical form of a job title. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[-_/,()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function familiesOfTitle(title: string): Set<string> {
  const lowered = normalizeTitle(title);
  const families = new Set<string>();
  for (const [family, markers] of Object.entries(ROLE_FAMILY_TITLES)) {
    if (markers.some((marker) => lowered.includes(marker))) {
      families.add(family);
    }
  }
  return families;
}

function familiesAdjacent(a: Set<string>, b: Set<string>): boolean {
  for (const mine of a) {
    for (const theirs of b) {
      if (ADJACENT_FAMILIES.has([mine, theirs].sort().join('|'))) return true;
    }
  }
  return false;
}

/**
 * Role: how close the job's title is to a title the candidate asked for.
 *
 * Best result across all preferred titles, on a deterministic ladder:
 * exact normalized equality → every preferred-title token appears in the
 * vacancy title ("Backend Engineer" ⊂ "Backend API Engineer") → same role
 * family → adjacent family → mismatch. A role mismatch is ALWAYS soft — the
 * specific product failure this codebase remembers is a filter that removed
 * jobs over a title word.
 */
export function alignRole(
  features: NormalizedJobFeatures,
  roles: string[],
): IntentAlignment {
  const vacancyTitle = normalizeTitle(features.title);
  const vacancyTokens = new Set(vacancyTitle.split(' '));
  const vacancyFamilies = familiesOfTitle(features.title);

  let best: IntentAlignment = {
    dimension: 'role',
    state: 'MISMATCH',
    reason: 'ROLE_MISMATCH',
    score: 0,
  };
  const better = (candidate: IntentAlignment) => {
    if ((candidate.score ?? 0) > (best.score ?? 0)) best = candidate;
  };

  for (const preferred of roles) {
    const wanted = normalizeTitle(preferred);
    if (!wanted) continue;
    if (wanted === vacancyTitle) {
      return {
        dimension: 'role',
        state: 'MATCH',
        reason: 'ROLE_EXACT',
        score: 1,
      };
    }
    const wantedTokens = wanted.split(' ');
    if (wantedTokens.every((token) => vacancyTokens.has(token))) {
      better({
        dimension: 'role',
        state: 'PARTIAL',
        reason: 'ROLE_RELATED',
        score: 0.85,
      });
      continue;
    }
    const wantedFamilies = familiesOfTitle(preferred);
    if ([...wantedFamilies].some((family) => vacancyFamilies.has(family))) {
      better({
        dimension: 'role',
        state: 'PARTIAL',
        reason: 'ROLE_FAMILY_MATCH',
        score: 0.6,
      });
    } else if (familiesAdjacent(wantedFamilies, vacancyFamilies)) {
      better({
        dimension: 'role',
        state: 'PARTIAL',
        reason: 'ROLE_FAMILY_ADJACENT',
        score: 0.4,
      });
    }
  }
  return best;
}

function sameText(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Location: a STRONG SOFT signal, never a filter.
 *
 * Best result across the candidate's preferred places, on the hierarchy
 * exact city → same region → same country. A REMOTE vacancy that names the
 * candidate's preferred country in `remoteCountriesAllowed` counts as a
 * country-level match; a REMOTE vacancy that names nothing is UNKNOWN
 * geography — REMOTE never means worldwide, and fabricating a match there
 * would quietly promise the candidate a job they may not be allowed to take.
 *
 * A vacancy with no structured location at all is UNKNOWN, not a mismatch:
 * 209 pre-migration vacancies have exactly that, and punishing them for
 * predating the schema would be scoring our own migration, not the job.
 *
 * `relocation === true` softens a known mismatch (0 → 0.3): the candidate
 * said other places are thinkable. It never turns a mismatch into a match,
 * and `relocation: null` changes nothing — "did not say" is not "yes".
 */
export function alignLocation(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
): IntentAlignment {
  const preferred = intent.locations;

  const hasOffice = features.country !== null;
  const remoteAllowed =
    features.workMode === 'REMOTE' ? features.remoteCountriesAllowed : [];
  if (!hasOffice && remoteAllowed.length === 0) {
    return {
      dimension: 'location',
      state: 'UNKNOWN',
      reason: 'LOCATION_UNKNOWN',
      score: null,
    };
  }

  let bestScore = -1;
  let bestReason = 'LOCATION_MISMATCH';
  for (const place of preferred) {
    const country = place.countryCode.toUpperCase();
    if (hasOffice && features.country === country) {
      if (place.city && sameText(features.city, place.city)) {
        return {
          dimension: 'location',
          state: 'MATCH',
          reason: 'LOCATION_EXACT',
          score: 1,
        };
      }
      if (place.region && sameText(features.region, place.region)) {
        if (bestScore < 0.75) {
          bestScore = 0.75;
          bestReason = 'LOCATION_REGION_MATCH';
        }
        continue;
      }
      // Same country. Full weight when the candidate only named the country;
      // a bit less when they named a city and this is elsewhere in it.
      const score = place.city || place.region ? 0.5 : 0.6;
      if (bestScore < score) {
        bestScore = score;
        bestReason = 'LOCATION_COUNTRY_MATCH';
      }
      continue;
    }
    if (remoteAllowed.includes(country)) {
      if (bestScore < 0.85) {
        bestScore = 0.85;
        bestReason = 'LOCATION_REMOTE_ELIGIBLE';
      }
    }
  }

  if (bestScore >= 0) {
    return {
      dimension: 'location',
      state: bestScore >= 1 ? 'MATCH' : 'PARTIAL',
      reason: bestReason,
      score: bestScore,
    };
  }
  return {
    dimension: 'location',
    state: 'MISMATCH',
    reason: 'LOCATION_MISMATCH',
    score: intent.relocation === true ? 0.3 : 0,
  };
}

export function alignWorkMode(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
): IntentAlignment {
  if (features.workMode === null) {
    return {
      dimension: 'workMode',
      state: 'UNKNOWN',
      reason: 'WORK_MODE_UNKNOWN',
      score: null,
    };
  }
  if (intent.workModes.includes(features.workMode)) {
    return {
      dimension: 'workMode',
      state: 'MATCH',
      reason: 'WORK_MODE_MATCH',
      score: 1,
    };
  }
  return {
    dimension: 'workMode',
    state: 'MISMATCH',
    reason: 'WORK_MODE_MISMATCH',
    score: 0,
  };
}

/**
 * Salary: compared in the candidate's own currency, whenever that is possible.
 *
 * The arithmetic lives in `compareSalary` / `MoneyNormalizer` so that an
 * external job — a Greenhouse or Ninehire posting with the same four salary
 * fields — goes through exactly the same comparison with no code of its own.
 *
 * `table` is the current exchange-rate snapshot, or null when none is usable.
 * A null table still compares same-currency pay perfectly; only a genuine
 * cross-currency case degrades, and it degrades to NOT_COMPARABLE — which is
 * neutral, scores nothing, and leaves the job exactly where it was in the
 * list. An outage of ours must never read as a fact about the employer.
 */
export function alignSalary(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
  table: RateTable | null = null,
): IntentAlignment {
  const wanted = intent.compensation;
  if (!wanted) {
    // Callers only align stated dimensions; kept total for safety.
    return {
      dimension: 'salary',
      state: 'UNKNOWN',
      reason: 'SALARY_UNKNOWN',
      score: null,
    };
  }

  const comparison = compareSalary(
    {
      min: features.salaryMin,
      max: features.salaryMax,
      currency: features.currency,
      payPeriod: features.payPeriod,
    },
    {
      min: wanted.minAmount,
      max: wanted.maxAmount,
      currency: wanted.currency,
      payPeriod: wanted.payPeriod,
    },
    table,
  );

  return {
    dimension: 'salary',
    state: comparison.state,
    reason: comparison.reason,
    score: comparison.score,
    // The numbers behind the verdict travel with it, so the card can show
    // "₩40M / year ≈ $28K / year" from the ranking that was actually computed
    // rather than re-deriving it later against different rates.
    salary: comparison.detail,
  };
}

export function alignEmployment(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
): IntentAlignment {
  if (features.employmentType === null) {
    return {
      dimension: 'employmentType',
      state: 'UNKNOWN',
      reason: 'EMPLOYMENT_UNKNOWN',
      score: null,
    };
  }
  if (intent.employmentTypes.includes(features.employmentType)) {
    return {
      dimension: 'employmentType',
      state: 'MATCH',
      reason: 'EMPLOYMENT_MATCH',
      score: 1,
    };
  }
  return {
    dimension: 'employmentType',
    state: 'MISMATCH',
    reason: 'EMPLOYMENT_MISMATCH',
    score: 0,
  };
}

/**
 * The one ordering the scale admits. LEAD/STAFF/MANAGER are tracks more than
 * rungs, but a deterministic adjacency needs one sequence, and this one is
 * how the product already presents the levels.
 */
const SENIORITY_ORDER: readonly SeniorityLevel[] = [
  'INTERN',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
  'STAFF',
  'MANAGER',
];

/**
 * Seniority the candidate WANTS vs the level the job is pitched at. This is
 * intent, not capability — wanting SENIOR is not being SENIOR, and the
 * evidence-side signals are where proven level lives. One step away counts
 * for half: a MID-wanting candidate is not wrong to be shown SENIOR roles.
 */
export function alignSeniority(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
): IntentAlignment {
  if (features.seniorityLevel === null) {
    return {
      dimension: 'seniority',
      state: 'UNKNOWN',
      reason: 'SENIORITY_UNKNOWN',
      score: null,
    };
  }
  if (intent.seniorityLevels.includes(features.seniorityLevel)) {
    return {
      dimension: 'seniority',
      state: 'MATCH',
      reason: 'SENIORITY_MATCH',
      score: 1,
    };
  }
  const jobIndex = SENIORITY_ORDER.indexOf(features.seniorityLevel);
  const adjacent = intent.seniorityLevels.some(
    (level) => Math.abs(SENIORITY_ORDER.indexOf(level) - jobIndex) === 1,
  );
  if (adjacent) {
    return {
      dimension: 'seniority',
      state: 'PARTIAL',
      reason: 'SENIORITY_ADJACENT',
      score: 0.5,
    };
  }
  return {
    dimension: 'seniority',
    state: 'MISMATCH',
    reason: 'SENIORITY_MISMATCH',
    score: 0,
  };
}

/**
 * Industries: exact normalized overlap between the candidate's preferred
 * industries and the domains the vacancy names. Both sides are free text, so
 * only exact (case-insensitive) equality counts — fuzzy matching two
 * folksonomies invents agreement neither side stated.
 */
export function alignIndustries(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
): IntentAlignment {
  if (features.industries.length === 0) {
    return {
      dimension: 'industries',
      state: 'UNKNOWN',
      reason: 'INDUSTRY_UNKNOWN',
      score: null,
    };
  }
  const offered = new Set(
    features.industries.map((entry) => entry.trim().toLowerCase()),
  );
  const overlap = intent.preferredIndustries.some((entry) =>
    offered.has(entry.trim().toLowerCase()),
  );
  if (overlap) {
    return {
      dimension: 'industries',
      state: 'MATCH',
      reason: 'INDUSTRY_MATCH',
      score: 1,
    };
  }
  return {
    dimension: 'industries',
    state: 'MISMATCH',
    reason: 'INDUSTRY_MISMATCH',
    score: 0,
  };
}

export function alignBenefits(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
): IntentAlignment {
  if (features.benefits.length === 0) {
    // An employer that listed no benefits has not stated "no benefits".
    return {
      dimension: 'benefits',
      state: 'UNKNOWN',
      reason: 'BENEFITS_UNKNOWN',
      score: null,
    };
  }
  const offered = new Set(features.benefits);
  const wanted = intent.preferredBenefits;
  const present = wanted.filter((benefit) => offered.has(benefit)).length;
  const fraction = present / wanted.length;
  if (fraction === 1) {
    return {
      dimension: 'benefits',
      state: 'MATCH',
      reason: 'BENEFITS_MATCH',
      score: 1,
    };
  }
  if (fraction > 0) {
    return {
      dimension: 'benefits',
      state: 'PARTIAL',
      reason: 'BENEFITS_PARTIAL',
      score: fraction,
    };
  }
  return {
    dimension: 'benefits',
    state: 'MISMATCH',
    reason: 'BENEFITS_MISMATCH',
    score: 0,
  };
}

/**
 * Every alignment for the dimensions the candidate actually STATED.
 *
 * A dimension the candidate said nothing about produces no entry at all —
 * not a neutral entry, no entry — so an empty preference list can never
 * penalize (or reward) any job, and a candidate with no preferences aligns
 * as `[]`, which the score combiner reads as "no intent signal exists".
 */
export function alignIntent(
  features: NormalizedJobFeatures,
  intent: CandidateJobIntent,
  /** Current FX snapshot, loaded ONCE per ranking run — never per vacancy. */
  table: RateTable | null = null,
): IntentAlignment[] {
  const alignments: IntentAlignment[] = [];
  if (intent.roles.length > 0) {
    alignments.push(alignRole(features, intent.roles));
  }
  if (intent.locations.length > 0) {
    alignments.push(alignLocation(features, intent));
  }
  if (intent.workModes.length > 0) {
    alignments.push(alignWorkMode(features, intent));
  }
  if (intent.compensation !== null) {
    alignments.push(alignSalary(features, intent, table));
  }
  if (intent.employmentTypes.length > 0) {
    alignments.push(alignEmployment(features, intent));
  }
  if (intent.seniorityLevels.length > 0) {
    alignments.push(alignSeniority(features, intent));
  }
  if (intent.preferredIndustries.length > 0) {
    alignments.push(alignIndustries(features, intent));
  }
  if (intent.preferredBenefits.length > 0) {
    alignments.push(alignBenefits(features, intent));
  }
  return alignments;
}
