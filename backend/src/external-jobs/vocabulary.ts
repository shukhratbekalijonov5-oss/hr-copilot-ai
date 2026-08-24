import type {
  EmploymentType,
  PayPeriod,
  WorkMode,
} from '../generated/prisma/enums';

/**
 * Provider words → this product's enums.
 *
 * ## Why these are dictionaries and not string massaging
 *
 * Every ATS invents its own vocabulary for the same three or four ideas, and
 * the values are usually TENANT-CONFIGURED rather than fixed by the vendor.
 * One Lever site writes `Full-time`, another writes `Full Time`, a third
 * writes `Temp Full-time`, `Fixed Term`, `Apprenticeship` or
 * `Full Time/Part Time` — all observed live, on three sites, in one afternoon.
 *
 * A normalizer that lowercased and stripped punctuation would map the first
 * three to FULL_TIME and be wrong about the third. One that matched substrings
 * would map `Full Time/Part Time` to FULL_TIME and hide a part-time job from
 * everyone filtering for one. So the rule is exact match against an explicit
 * table, and anything absent from it is **null**.
 *
 * Null is a safe answer here and a wrong enum is not: unstated employment type
 * never excludes a job from a candidate's results, it only stops it earning a
 * point it did not prove. A wrong one is trusted, invisible and acts like a
 * fact.
 *
 * ## Provider-neutral on purpose
 *
 * There is no `leverEmploymentType()`. "Full-time means FULL_TIME" is not a
 * fact about Lever, and the next provider will write some of the same words.
 * Providers add ENTRIES here; they do not get their own mapper.
 */

/** Fold a provider's label to a lookup key: lowercase, single-spaced. */
function key(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Employment type.
 *
 * Deliberately absent, with reasons:
 *
 *   "full time/part time"  two answers, so no answer
 *   "temp full-time"       temporary AND full-time; the schema holds one
 *   "fixed term"           a contract duration, not an employment type
 *   "apprenticeship"       not INTERNSHIP — different status, pay and law
 *   "permanent"            describes tenure, not hours
 *   "freelance"            close to CONTRACT but not the same relationship
 */
const EMPLOYMENT: Record<string, EmploymentType> = {
  'full time': 'FULL_TIME',
  fulltime: 'FULL_TIME',
  'part time': 'PART_TIME',
  parttime: 'PART_TIME',
  contract: 'CONTRACT',
  contractor: 'CONTRACT',
  internship: 'INTERNSHIP',
  intern: 'INTERNSHIP',
  temporary: 'TEMPORARY',
  temp: 'TEMPORARY',
};

export function employmentTypeFrom(value: unknown): EmploymentType | null {
  if (typeof value !== 'string') return null;
  return EMPLOYMENT[key(value)] ?? null;
}

/**
 * Work arrangement — but ONLY from a structured field.
 *
 * This maps a value a provider states in a dedicated field. It must never be
 * fed a location label or a description: "Hybrid - London" is a recruiter's
 * prose, and reading an arrangement out of it is how a product ends up
 * confidently wrong about where people have to be.
 *
 * `unspecified` is a real Lever value and means exactly what it says, so it
 * maps to null rather than being treated as missing data to guess at.
 */
const WORK_MODE: Record<string, WorkMode> = {
  onsite: 'ONSITE',
  'on site': 'ONSITE',
  'in office': 'ONSITE',
  remote: 'REMOTE',
  hybrid: 'HYBRID',
};

export function workModeFrom(value: unknown): WorkMode | null {
  if (typeof value !== 'string') return null;
  return WORK_MODE[key(value)] ?? null;
}

/**
 * Pay period.
 *
 * The enum holds HOURLY, MONTHLY and YEARLY. Providers emit more than that —
 * Lever returns `per-year-salary`, `bi-week-salary` and `one-time`; Ashby
 * writes a quantity and a unit (`1 YEAR`, `1 MONTH`) and uses `NONE` for
 * components that have no period at all, such as an equity percentage. The
 * ones with no home here map to null.
 *
 * That is the important case, so it is worth being explicit about: a
 * bi-weekly figure is NOT annualised on the way in. Multiplying by 26 would
 * turn a stated fact into a derived one and store it as though the employer
 * had said it. The amount is kept, the period is null, and the salary matcher
 * reports it as not comparable — visible, honest, and impossible to mistake
 * for a salary the employer published.
 */
const PAY_PERIOD: Record<string, PayPeriod> = {
  hourly: 'HOURLY',
  '1 hour': 'HOURLY',
  // schema.org writes the unit alone in QuantitativeValue.unitText. DAY and
  // WEEK appear there too and are deliberately absent: the schema holds three
  // periods, and multiplying a weekly figure by 52 would store a number the
  // employer never published.
  hour: 'HOURLY',
  'per hour': 'HOURLY',
  'per hour wage': 'HOURLY',
  'per hour salary': 'HOURLY',
  monthly: 'MONTHLY',
  month: 'MONTHLY',
  'per month': 'MONTHLY',
  'per month salary': 'MONTHLY',
  'per month wage': 'MONTHLY',
  // Ashby states an interval as a quantity and a unit.
  '1 month': 'MONTHLY',
  yearly: 'YEARLY',
  year: 'YEARLY',
  annual: 'YEARLY',
  annually: 'YEARLY',
  'per year': 'YEARLY',
  'per year salary': 'YEARLY',
  'per year wage': 'YEARLY',
  '1 year': 'YEARLY',
};

export function payPeriodFrom(value: unknown): PayPeriod | null {
  if (typeof value !== 'string') return null;
  return PAY_PERIOD[key(value)] ?? null;
}
