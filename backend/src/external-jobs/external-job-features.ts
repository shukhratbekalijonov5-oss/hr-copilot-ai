import type { NormalizedJobFeatures } from '../matching/normalized-job-features';
import type {
  EmploymentType,
  JobBenefit,
  PayPeriod,
  SeniorityLevel,
  WorkMode,
} from '../generated/prisma/enums';

/**
 * The ONE point where an external job meets the matching system.
 *
 * Everything that ranks jobs — hard exclusions, intent alignment, the salary
 * matcher, Find Jobs ordering, AI Job Match — reads `NormalizedJobFeatures`
 * and nothing else. So making external jobs matchable is not a new pipeline;
 * it is this function, and then they are simply jobs.
 *
 * That is the test of whether the external domain was modelled correctly. If
 * this file needed a `provider` argument, or a currency conversion, or a
 * special case for a Korean ATS, the abstraction would have leaked and the
 * ranking would already be growing per-provider branches. It needs none of
 * them: the external schema deliberately stores the same vocabulary a Vacancy
 * does, so the mapping is a rename and nothing more.
 *
 * ## Salary is NOT converted here
 *
 * `salaryMin/Max/currency/payPeriod` pass through in the source's own currency,
 * exactly as a Vacancy's do. Conversion happens later, once, in the FX pipeline
 * Task 3B built — which means a 40,000,000 KRW Ninehire posting and a 70,000
 * USD Greenhouse posting are compared against a candidate's stated range by the
 * same code that already compares internal jobs, with no provider-specific
 * arithmetic anywhere.
 */

/** The external columns the features mapping reads. */
export interface ExternalJobFeatureColumns {
  id: string;
  title: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  workMode: WorkMode | null;
  remoteCountriesAllowed: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: PayPeriod | null;
  employmentType: EmploymentType | null;
  seniorityLevel: SeniorityLevel | null;
  benefits: JobBenefit[];
  industries: string[];
  company: { name: string };
}

/** The narrow select matching `ExternalJobFeatureColumns`. */
export const EXTERNAL_JOB_FEATURE_SELECT = {
  id: true,
  title: true,
  countryCode: true,
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
  industries: true,
  company: { select: { name: true } },
} as const;

export function externalJobFeatures(
  row: ExternalJobFeatureColumns,
): NormalizedJobFeatures {
  return {
    jobId: row.id,
    sourceType: 'EXTERNAL',
    title: row.title,
    // Used ONLY for the candidate's explicit company exclusions, exactly as
    // for internal jobs. Never a ranking signal, so an external company's
    // unfamiliar name cannot cost its jobs a place.
    organizationName: row.company.name,
    country: row.countryCode ? row.countryCode.toUpperCase() : null,
    region: row.region,
    city: row.city,
    workMode: row.workMode,
    remoteCountriesAllowed: row.remoteCountriesAllowed.map((code) =>
      code.toUpperCase(),
    ),
    // Untouched, in the currency the employer posted. See the note above.
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    currency: row.currency,
    payPeriod: row.payPeriod,
    // Already a real EmploymentType: external providers normalize at their own
    // boundary, so unlike the legacy free-text Vacancy column there is nothing
    // left to bridge here.
    employmentType: row.employmentType,
    seniorityLevel: row.seniorityLevel,
    benefits: row.benefits,
    industries: row.industries,
  };
}
