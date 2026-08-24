import type { PayPeriod } from '../generated/prisma/enums';
import { normalizeSalary, type RateTable, type SalaryRange } from '../fx/money';

/**
 * Does this job pay what the candidate is looking for?
 *
 * ## Provider-neutral by construction
 *
 * The input is a `SalaryRange` — four plain fields — and NOT a vacancy. An
 * internal Prisma row, a Greenhouse posting, a Lever job or a Ninehire listing
 * all reduce to the same four fields, so all four compare through this one
 * function. There is deliberately no way to write a per-provider currency path:
 * a provider that wants its salaries matched normalizes into
 * `{min, max, currency, payPeriod}` and is done.
 *
 * ## Currency is the candidate's
 *
 * Comparison happens in the currency the CANDIDATE stated their expectation
 * in, not the provider's and not some internal base. A candidate asking for
 * USD sees Korean, Australian and Canadian salaries expressed in USD, which is
 * the only frame in which "does this meet what I asked for" has an answer they
 * can check.
 *
 * ## Nothing here hides a job
 *
 * Every outcome is a score or a null. Below-minimum pay, an unstated salary,
 * an unusable exchange rate and an incomparable pay period are all soft: they
 * change where a job sits in the list and never whether it is in the list.
 * People take pay cuts for the right role, and a missing rate is our problem,
 * not a reason to withhold a job from someone.
 */

export type SalaryAlignmentState =
  'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN' | 'NOT_COMPARABLE';

export type SalaryReason =
  | 'SALARY_WITHIN_DESIRED_RANGE'
  | 'SALARY_ABOVE_DESIRED_RANGE'
  | 'SALARY_PARTIAL_OVERLAP'
  | 'SALARY_MEETS_MINIMUM'
  | 'SALARY_BELOW_MINIMUM'
  | 'SALARY_UNKNOWN'
  | 'SALARY_NOT_COMPARABLE';

/** What the candidate asked for. `max` is a target, never a ceiling. */
export interface DesiredSalary {
  min: number;
  /** Upper end of the range they had in mind, when they named one. */
  max: number | null;
  currency: string;
  payPeriod: PayPeriod;
}

/**
 * The numbers behind a salary verdict, for the UI to show and for Gemini to
 * narrate — never to recompute. The original is always present; the converted
 * pair appears only when a conversion actually happened.
 */
export interface SalaryComparisonDetail {
  originalMin: number | null;
  originalMax: number | null;
  originalCurrency: string | null;
  originalPayPeriod: PayPeriod | null;
  convertedMin: number | null;
  convertedMax: number | null;
  convertedCurrency: string | null;
  convertedPayPeriod: PayPeriod | null;
}

export interface SalaryComparison {
  state: SalaryAlignmentState;
  reason: SalaryReason;
  /** 0..1, or null when the dimension could not be compared at all. */
  score: number | null;
  detail: SalaryComparisonDetail;
}

function detailOf(
  offered: SalaryRange,
  converted: {
    min: number | null;
    max: number | null;
    currency: string;
    payPeriod: PayPeriod;
  } | null,
): SalaryComparisonDetail {
  return {
    originalMin: offered.min,
    originalMax: offered.max,
    originalCurrency: offered.currency,
    originalPayPeriod: offered.payPeriod,
    convertedMin: converted?.min ?? null,
    convertedMax: converted?.max ?? null,
    convertedCurrency: converted?.currency ?? null,
    convertedPayPeriod: converted?.payPeriod ?? null,
  };
}

/**
 * Compares one job's pay against one candidate's stated expectation.
 *
 * `table` is the current FX snapshot, or null when none is usable. A null
 * table still compares same-currency salaries perfectly well — only a genuine
 * cross-currency case degrades to NOT_COMPARABLE.
 */
export function compareSalary(
  offered: SalaryRange,
  desired: DesiredSalary,
  table: RateTable | null,
): SalaryComparison {
  const normalized = normalizeSalary(
    offered,
    desired.currency,
    desired.payPeriod,
    table,
  );

  if (!normalized.ok) {
    // UNSTATED and "we could not convert" are different facts and the reader
    // is told which: one is the employer's silence, the other is our missing
    // rate. Collapsing them would blame the employer for our outage.
    const unknown = normalized.reason === 'UNSTATED';
    return {
      state: unknown ? 'UNKNOWN' : 'NOT_COMPARABLE',
      reason: unknown ? 'SALARY_UNKNOWN' : 'SALARY_NOT_COMPARABLE',
      score: null,
      detail: detailOf(offered, null),
    };
  }

  const salary = normalized.salary;
  const detail = detailOf(offered, salary);
  // A one-sided posting ("from ₩40M") is treated as the band it implies.
  const low = salary.min ?? salary.max;
  const high = salary.max ?? salary.min;
  if (low === null || high === null) {
    return {
      state: 'UNKNOWN',
      reason: 'SALARY_UNKNOWN',
      score: null,
      detail,
    };
  }

  // --- floor-only expectation: the candidate named a minimum and no target --
  if (desired.max === null) {
    if (low >= desired.min) {
      return {
        state: 'MATCH',
        reason: 'SALARY_MEETS_MINIMUM',
        score: 1,
        detail,
      };
    }
    if (high >= desired.min) {
      // The band straddles their floor: the role CAN pay it, at its top end.
      return {
        state: 'PARTIAL',
        reason: 'SALARY_PARTIAL_OVERLAP',
        score: 0.75,
        detail,
      };
    }
    return {
      state: 'MISMATCH',
      reason: 'SALARY_BELOW_MINIMUM',
      score: 0,
      detail,
    };
  }

  // --- a stated range -----------------------------------------------------
  if (low >= desired.min && high <= desired.max) {
    return {
      state: 'MATCH',
      reason: 'SALARY_WITHIN_DESIRED_RANGE',
      score: 1,
      detail,
    };
  }

  // ABOVE the range they named. Scored as a full match on purpose: their
  // maximum is the top of what they hoped for, not a limit on what they will
  // accept, and marking a better-paying job down would be the system deciding
  // something about their money that they did not say.
  if (low > desired.max) {
    return {
      state: 'MATCH',
      reason: 'SALARY_ABOVE_DESIRED_RANGE',
      score: 1,
      detail,
    };
  }

  // Overlaps the range from below (or spans it entirely).
  if (high >= desired.min) {
    return {
      state: 'PARTIAL',
      reason: 'SALARY_PARTIAL_OVERLAP',
      score: 0.75,
      detail,
    };
  }

  return {
    state: 'MISMATCH',
    reason: 'SALARY_BELOW_MINIMUM',
    score: 0,
    detail,
  };
}
