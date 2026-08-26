import type {
  JobBenefit,
  LanguageProficiency,
  PayPeriod,
  SeniorityLevel,
  WorkMode,
} from '../generated/prisma/enums';
import {
  normalizeEmploymentType,
  type EmploymentTypeValue,
} from '../common/vacancy/job-vocabulary';

/**
 * A job as the matcher sees it — provider-neutral on purpose.
 *
 * Internal vacancies normalize INTO this shape here; a Greenhouse, Lever,
 * Ashby or Ninehire job will normalize into the SAME shape through its own
 * adapter, and the alignment/constraint code in this folder never learns
 * where a job came from. That is the whole point: preference logic is written
 * once, against this, not once per source.
 *
 * Every nullable field means "the employer did not state this". `[]` on an
 * array means the same. Nothing here is ever guessed from prose — a vacancy
 * whose employer never named a salary has `salaryMin/Max: null`, and the
 * matcher treats that as UNKNOWN, never as zero.
 */
/**
 * Which catalogue a job belongs to.
 *
 * Carried on the features themselves so a caller never has to infer origin
 * from the shape of an id — two UUIDs look identical, and guessing wrong means
 * sending a candidate to apply in the wrong place.
 */
export type JobSourceType = 'INTERNAL' | 'EXTERNAL';

export interface NormalizedJobFeatures {
  /**
   * The job's id WITHIN its catalogue. Called `jobId` rather than `vacancyId`
   * because an external posting is not a Vacancy and never becomes one: this
   * shape is the single point where the internal and external domains meet,
   * and a field named after one of them would be a lie in the other half.
   */
  jobId: string;
  sourceType: JobSourceType;
  title: string;
  /** For explicit-exclusion matching only, never a ranking signal. */
  organizationName: string;

  /** ISO 3166-1 alpha-2, uppercase, or null when unstated. */
  country: string | null;
  region: string | null;
  city: string | null;
  workMode: WorkMode | null;
  /**
   * ISO country codes a REMOTE role may be worked from. `[]` = the employer
   * did not say — which is UNKNOWN geography, NOT "worldwide". See
   * `alignLocation` for how that distinction is enforced.
   */
  remoteCountriesAllowed: string[];

  /** Major currency units, as stored. Null = unstated. */
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: PayPeriod | null;

  /**
   * Normalized through the ONE bridge (`normalizeEmploymentType`) from the
   * legacy free-text column. Null = unstated or unrecognized — never a
   * defaulted FULL_TIME.
   */
  employmentType: EmploymentTypeValue | null;
  seniorityLevel: SeniorityLevel | null;
  benefits: JobBenefit[];
  /** From `domainExperience`: the domains the role touches. Free text. */
  industries: string[];
}

/**
 * The vacancy columns the RANKING actually reads, and nothing else.
 *
 * This select is load-bearing twice over: it is what `normalizedJobFeatures`
 * is built from, and it is the exact input to `vacancyRankingFingerprint` —
 * so a field is ranking-relevant if and only if it appears here. Display-only
 * fields (department, applicationDeadline, openingsCount, hiringUrgency,
 * benefitsOther, the legacy free-text location) are deliberately absent:
 * editing them must not invalidate every candidate's stored ranking.
 *
 * `description` and `requirements` are here even though this module never
 * scores them, because they feed the capability signals (semantic similarity
 * and requirement coverage) through the vacancy index — an edit to either is
 * a ranking-relevant change. Fields the algorithm does not read yet
 * (languages, visa policy, education) are excluded; scoring them later is an
 * algorithm change and bumps MATCH_ALGORITHM_VERSION, which invalidates
 * snapshots by itself.
 */
export const RANKING_VACANCY_SELECT = {
  id: true,
  title: true,
  description: true,
  country: true,
  region: true,
  city: true,
  workMode: true,
  remoteCountriesAllowed: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  payPeriod: true,
  employmentType: true,
  seniorityLevel: true,
  benefits: true,
  domainExperience: true,
  organization: { select: { name: true } },
  requirements: {
    select: { text: true, required: true },
    orderBy: { id: 'asc' as const },
  },
  // Language requirements became a scoring input with the advanced match
  // (languageFit dimension + eligibility) in algorithm v4, so an edit to them
  // must invalidate stored rankings like any other ranking-relevant change.
  languages: {
    select: { languageCode: true, level: true, required: true },
    orderBy: { languageCode: 'asc' as const },
  },
} as const;

/** One row of the ranking universe, as `RANKING_VACANCY_SELECT` returns it. */
export interface RankingVacancyRow {
  id: string;
  title: string;
  description: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  workMode: WorkMode | null;
  remoteCountriesAllowed: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: PayPeriod | null;
  employmentType: string | null;
  seniorityLevel: SeniorityLevel | null;
  benefits: JobBenefit[];
  domainExperience: string[];
  organization: { name: string };
  requirements: { text: string; required: boolean }[];
  languages: {
    languageCode: string;
    level: LanguageProficiency;
    required: boolean;
  }[];
}

/**
 * The columns `normalizedJobFeatures` ACTUALLY reads.
 *
 * `description` and `requirements` sit in RANKING_VACANCY_SELECT for the
 * fingerprint's sake, not this function's — it has never touched either. Saying
 * so in the type lets a caller that only needs to RANK (Find Jobs ordering a
 * search) select the narrow set, instead of pulling every description and
 * requirement row in the catalogue to read a work mode.
 */
export type JobFeatureColumns = Omit<
  RankingVacancyRow,
  'description' | 'requirements' | 'languages'
>;

/** The narrow select matching `JobFeatureColumns`. A subset of RANKING_VACANCY_SELECT. */
export const JOB_FEATURE_SELECT = {
  id: true,
  title: true,
  country: true,
  region: true,
  city: true,
  workMode: true,
  remoteCountriesAllowed: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  payPeriod: true,
  employmentType: true,
  seniorityLevel: true,
  benefits: true,
  domainExperience: true,
  organization: { select: { name: true } },
} as const;

export function normalizedJobFeatures(
  row: JobFeatureColumns,
): NormalizedJobFeatures {
  return {
    jobId: row.id,
    sourceType: 'INTERNAL',
    title: row.title,
    organizationName: row.organization.name,
    country: row.country ? row.country.toUpperCase() : null,
    region: row.region,
    city: row.city,
    workMode: row.workMode,
    remoteCountriesAllowed: row.remoteCountriesAllowed.map((code) =>
      code.toUpperCase(),
    ),
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    currency: row.currency,
    payPeriod: row.payPeriod,
    employmentType: normalizeEmploymentType(row.employmentType),
    seniorityLevel: row.seniorityLevel,
    benefits: row.benefits,
    industries: row.domainExperience,
  };
}
