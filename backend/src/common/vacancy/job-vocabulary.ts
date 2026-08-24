/**
 * The shared vocabulary a JOB is described in.
 *
 * Internal vacancies are the only producer today, but these names and value
 * spaces are chosen so an externally sourced job can normalize INTO them
 * without a translation layer: country/region/city, workMode, salaryMin/Max +
 * currency + payPeriod, seniorityLevel, min/preferredExperienceYears,
 * languages, visa/work-authorization, benefits. Anything internal-only (owner,
 * pipeline, requirements-as-evidence-checks) deliberately stays out.
 *
 * Codes over names, everywhere. A country stored as "South Korea" is a
 * different value from "대한민국" and from "Республика Корея"; stored as `KR`
 * it is one value that every locale can render (the UI resolves display names
 * from its own translated tables — deliberately not Intl.DisplayNames, whose
 * ICU data differs between Node and the browser and breaks hydration).
 *
 * BOTH SIDES OF A MATCH SPEAK THIS VOCABULARY. A vacancy describes what an
 * employer offers and a CandidateJobPreferences row describes what a candidate
 * wants, and they are comparable only because they use the same value spaces —
 * the same ISO country codes, the same WorkMode, SeniorityLevel, PayPeriod,
 * currency and JobBenefit members. A future external job normalizes into these
 * same names, so nothing here may be specific to how a job was sourced.
 */

/**
 * ISO-4217 alpha-3 codes the product accepts.
 *
 * A curated allow-list rather than a database enum: adding a currency must not
 * need a migration, and rejecting free text is what actually matters — a
 * salary stored in "won" / "₩" / "KRW" three different ways is unmatchable.
 */
export const SUPPORTED_CURRENCIES = [
  'KRW',
  'USD',
  'EUR',
  'JPY',
  'GBP',
  'UZS',
  'RUB',
  'KZT',
  'CNY',
  'INR',
  'SGD',
  'AED',
  'AUD',
  'CAD',
  'CHF',
  'TRY',
  'PLN',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** ISO 3166-1 alpha-2, uppercase. */
export const ISO_COUNTRY_PATTERN = /^[A-Z]{2}$/;

/**
 * BCP-47 primary language subtag, lowercase (`ko`, `en`, `uz`, and the
 * three-letter subtags for smaller languages).
 *
 * Deliberately NOT restricted to the four UI locales: a Seoul job may require
 * Japanese even though the interface does not speak it.
 */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}$/;

/**
 * A visa class as the issuing country writes it — "E-7", "F-2", "H-1B".
 *
 * Free-form on purpose. Visa classes are per-country and change by regulation;
 * an enum spelling only Korean ones could not describe a job anywhere else,
 * which is precisely the Korea-only assumption this model must not bake in.
 */
export const VISA_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9. /-]{0,19}$/;

/** Bounds that keep a single vacancy from becoming an unbounded payload. */
export const VACANCY_LIMITS = {
  /** 0–7 — a week has seven days. */
  maxOfficeDaysPerWeek: 7,
  /** Nobody has 80 years of professional experience. */
  maxExperienceYears: 80,
  maxOpeningsCount: 10_000,
  /** 50 years of fixed term is not a fixed term. */
  maxContractDurationMonths: 600,
  maxVisaTypes: 20,
  maxNationalities: 50,
  maxRemoteCountries: 50,
  maxCertifications: 30,
  maxDomainExperience: 30,
  maxLanguages: 20,
  /** Major currency units; ~1e10 covers any real salary in KRW or UZS. */
  maxSalary: 100_000_000_000,
} as const;

/** Free-text entries inside the structured arrays (certifications, domains). */
export const MAX_TAG_LENGTH = 80;

/* -------------------------------------------------------------------------- */
/* Employment type                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The legacy free-text employment values a Vacancy actually holds today, mapped
 * to the normalized `EmploymentType` enum.
 *
 * `vacancies.employmentType` is still a String and stays that way: 206 rows
 * carry these display strings, the recruiter form has always written canonical
 * English into them, and rewriting the column was neither necessary nor in
 * scope. Candidate preferences store the ENUM, so this table is the single
 * bridge between the two representations — one vocabulary with one explicit
 * translation point, rather than two vocabularies that drift.
 *
 * Matching against it is case- and separator-insensitive, so "Full-time",
 * "full time" and "FULL_TIME" all resolve to the same member.
 */
const EMPLOYMENT_TYPE_ALIASES: Record<string, EmploymentTypeValue> = {
  fulltime: 'FULL_TIME',
  parttime: 'PART_TIME',
  contract: 'CONTRACT',
  contractor: 'CONTRACT',
  freelance: 'CONTRACT',
  internship: 'INTERNSHIP',
  intern: 'INTERNSHIP',
  temporary: 'TEMPORARY',
  temp: 'TEMPORARY',
};

/** Mirrors the Prisma `EmploymentType` enum without importing the client. */
export type EmploymentTypeValue =
  'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY';

/**
 * A vacancy's free-text employment type as a normalized value, or null when it
 * says nothing recognizable.
 *
 * Null is deliberate and must stay meaningful: an unmappable string is "this
 * job did not state an employment type in a form we understand", never a
 * default like FULL_TIME. Guessing here would let a preference filter silently
 * include or exclude jobs on a value nobody wrote.
 */
export function normalizeEmploymentType(
  value: string | null | undefined,
): EmploymentTypeValue | null {
  if (!value) return null;
  const key = value.toLowerCase().replace(/[\s_-]/g, '');
  return EMPLOYMENT_TYPE_ALIASES[key] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Candidate job preferences                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Bounds on one candidate's stated intent. Generous enough for a real job
 * search, small enough that a preference profile can never become an unbounded
 * payload or an expensive filter.
 */
export const PREFERENCE_LIMITS = {
  maxJobTitles: 20,
  maxLocations: 30,
  maxExcludedLocations: 30,
  maxIndustries: 20,
  maxExcludedCompanies: 50,
  maxExcludedJobTitles: 30,
  /** Major currency units, matching the vacancy side. */
  maxSalary: VACANCY_LIMITS.maxSalary,
} as const;

/** One free-text preference entry: a role, an industry, a company name. */
export const MAX_PREFERENCE_ENTRY_LENGTH = 120;

/**
 * Trims, drops blanks and removes case-insensitive duplicates while KEEPING
 * the first spelling the candidate used.
 *
 * "devops engineer" and "DevOps Engineer" are one preference, and the
 * candidate's own capitalization is the one worth showing back to them.
 */
export function normalizePreferenceEntries(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** De-duplicates an enum list while preserving the order given. */
export function normalizeEnumList<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}
