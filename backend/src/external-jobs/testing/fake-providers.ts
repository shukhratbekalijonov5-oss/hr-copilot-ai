import { plainDescription, safeUrl } from '../normalize';
import {
  countryCode,
  currencyCode,
  enumValue,
  salaryAmount,
  tags,
  text,
  timestamp,
  EMPLOYMENT_TYPES,
  SENIORITY_LEVELS,
  WORK_MODES,
  PAY_PERIODS,
} from '../normalize';
import { EXTERNAL_JOB_LIMITS } from '../external-job.limits';
import type { NormalizedExternalJobInput } from '../external-job.contract';

/**
 * FAKE provider payloads and normalizers, for tests only.
 *
 * These are hand-written approximations of the SHAPES the real APIs are known
 * to use — nested offices, a `categories` object, a postal address, a Korean
 * field set. No real endpoint is called and no real response is reproduced;
 * the point is not to be accurate about any vendor, it is to prove that four
 * genuinely different shapes can reach `NormalizedExternalJobInput` without
 * anything downstream learning their names.
 *
 * If a future provider cannot be written as one of these functions, the
 * contract is wrong and should change here rather than leaking outward.
 */

/** Greenhouse-like: offices array, HTML content, `absolute_url`. */
export interface FakeGreenhousePosting {
  id: number;
  title: string;
  absolute_url: string;
  content: string;
  updated_at?: string;
  offices?: { name: string; location?: string }[];
  metadata?: { name: string; value: string | null }[];
  company?: { name: string; url?: string };
}

export function normalizeGreenhouse(
  raw: FakeGreenhousePosting,
  boardCompany: string,
): NormalizedExternalJobInput | null {
  const title = text(raw.title, EXTERNAL_JOB_LIMITS.maxTitleLength);
  const url = safeUrl(raw.absolute_url);
  if (!title || !url) return null;

  const office = raw.offices?.[0];
  // "Seoul, South Korea" → city only. The country is NOT inferred from the
  // country NAME: mapping names to ISO codes is a lookup this layer does not
  // have, and a wrong code is worse than a null one.
  const city = office?.name ? office.name.split(',')[0].trim() : null;
  const meta = new Map(
    (raw.metadata ?? []).map((entry) => [
      entry.name.toLowerCase(),
      entry.value,
    ]),
  );

  return {
    provider: 'GREENHOUSE',
    accessMethod: 'OFFICIAL_API',
    sourceJobId: String(raw.id),
    sourceUrl: url,
    originalUrl: url,
    companyName: raw.company?.name ?? boardCompany,
    companyWebsiteUrl: safeUrl(raw.company?.url),
    companyCountryCode: null,
    title,
    description: plainDescription(
      raw.content,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ),
    requirementsText: null,
    countryCode: countryCode(meta.get('country')),
    region: null,
    city: text(city, 120),
    workMode: enumValue(meta.get('work mode'), WORK_MODES),
    additionalLocations: [],
    remoteCountriesAllowed: [],
    employmentType: enumValue(meta.get('employment type'), EMPLOYMENT_TYPES),
    seniorityLevel: enumValue(meta.get('seniority'), SENIORITY_LEVELS),
    salaryMin: salaryAmount(meta.get('salary min')),
    salaryMax: salaryAmount(meta.get('salary max')),
    currency: currencyCode(meta.get('salary currency')),
    payPeriod: enumValue(meta.get('salary period'), PAY_PERIODS),
    skills: [],
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    expiresAt: null,
    employerPosted: null,
    closedAtSource: false,
  };
}

/** Lever-like: `categories` object, `hostedUrl`, `descriptionPlain`. */
export interface FakeLeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  categories?: {
    location?: string;
    commitment?: string;
    team?: string;
  };
  salaryRange?: {
    min?: number;
    max?: number;
    currency?: string;
    interval?: string;
  };
  createdAt?: number;
}

export function normalizeLever(
  raw: FakeLeverPosting,
  company: { name: string; url?: string },
): NormalizedExternalJobInput | null {
  const title = text(raw.text, EXTERNAL_JOB_LIMITS.maxTitleLength);
  const url = safeUrl(raw.hostedUrl);
  if (!title || !url) return null;

  const location = raw.categories?.location ?? null;
  return {
    provider: 'LEVER',
    accessMethod: 'OFFICIAL_API',
    sourceJobId: raw.id,
    sourceUrl: url,
    originalUrl: safeUrl(raw.applyUrl) ?? url,
    companyName: company.name,
    companyWebsiteUrl: safeUrl(company.url),
    companyCountryCode: null,
    title,
    description: plainDescription(
      raw.descriptionPlain,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ),
    requirementsText: null,
    countryCode: null,
    region: null,
    city: text(location?.split(',')[0], 120),
    workMode: null,
    additionalLocations: [],
    remoteCountriesAllowed: [],
    // Lever's "commitment" is the closest thing to an employment type; when it
    // does not map to one of ours it stays null rather than becoming FULL_TIME.
    employmentType: enumValue(raw.categories?.commitment, EMPLOYMENT_TYPES),
    seniorityLevel: null,
    salaryMin: salaryAmount(raw.salaryRange?.min),
    salaryMax: salaryAmount(raw.salaryRange?.max),
    currency: currencyCode(raw.salaryRange?.currency),
    payPeriod: enumValue(raw.salaryRange?.interval, PAY_PERIODS),
    skills: [],
    industries: tags(raw.categories?.team ? [raw.categories.team] : [], 30),
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    expiresAt: null,
    employerPosted: null,
    closedAtSource: false,
  };
}

/** Ashby-like: postal address, `isListed`, structured compensation. */
export interface FakeAshbyPosting {
  id: string;
  title: string;
  jobUrl: string;
  descriptionHtml?: string;
  isListed?: boolean;
  employmentType?: string;
  address?: {
    postalAddress?: {
      addressCountry?: string;
      addressRegion?: string;
      addressLocality?: string;
    };
  };
  isRemote?: boolean;
  compensation?: {
    minValue?: number;
    maxValue?: number;
    currencyCode?: string;
    interval?: string;
  };
}

export function normalizeAshby(
  raw: FakeAshbyPosting,
  company: { name: string; url?: string },
): NormalizedExternalJobInput | null {
  const title = text(raw.title, EXTERNAL_JOB_LIMITS.maxTitleLength);
  const url = safeUrl(raw.jobUrl);
  if (!title || !url) return null;

  const address = raw.address?.postalAddress;
  return {
    provider: 'ASHBY',
    accessMethod: 'OFFICIAL_API',
    sourceJobId: raw.id,
    sourceUrl: url,
    originalUrl: url,
    companyName: company.name,
    companyWebsiteUrl: safeUrl(company.url),
    companyCountryCode: null,
    title,
    description: plainDescription(
      raw.descriptionHtml,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ),
    requirementsText: null,
    countryCode: countryCode(address?.addressCountry),
    region: text(address?.addressRegion, 120),
    city: text(address?.addressLocality, 120),
    // `isRemote: true` is a stated fact; false is NOT evidence of on-site, so
    // it becomes null rather than ONSITE.
    workMode: raw.isRemote === true ? 'REMOTE' : null,
    // Remote-eligible countries are not stated by this shape, and REMOTE never
    // means worldwide.
    additionalLocations: [],
    remoteCountriesAllowed: [],
    employmentType: enumValue(raw.employmentType, EMPLOYMENT_TYPES),
    seniorityLevel: null,
    salaryMin: salaryAmount(raw.compensation?.minValue),
    salaryMax: salaryAmount(raw.compensation?.maxValue),
    currency: currencyCode(raw.compensation?.currencyCode),
    payPeriod: enumValue(raw.compensation?.interval, PAY_PERIODS),
    skills: [],
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    expiresAt: null,
    employerPosted: null,
    closedAtSource: raw.isListed === false,
  };
}

/**
 * Ninehire-like: a Korean ATS shape — KRW salary in 만원 or won, Korean city
 * names, a career-level field, a closing date.
 *
 * Deliberately the most different of the four: if the contract can absorb this
 * without anything downstream noticing, the Korean-ATS requirement is met by
 * architecture rather than by a special case.
 */
export interface FakeNinehirePosting {
  recruitmentId: string;
  recruitmentTitle: string;
  detailUrl: string;
  contentHtml?: string;
  companyName: string;
  companyUrl?: string;
  workplace?: { country?: string; city?: string };
  careerLevel?: string;
  workType?: string;
  remoteWork?: boolean;
  annualSalary?: { from?: number; to?: number; currency?: string };
  closingDate?: string;
  isClosed?: boolean;
  requiredLanguages?: string[];
}

export function normalizeNinehire(
  raw: FakeNinehirePosting,
): NormalizedExternalJobInput | null {
  const title = text(raw.recruitmentTitle, EXTERNAL_JOB_LIMITS.maxTitleLength);
  const url = safeUrl(raw.detailUrl);
  const company = text(
    raw.companyName,
    EXTERNAL_JOB_LIMITS.maxCompanyNameLength,
  );
  if (!title || !url || !company) return null;

  return {
    provider: 'NINEHIRE',
    accessMethod: 'OFFICIAL_API',
    sourceJobId: raw.recruitmentId,
    sourceUrl: url,
    originalUrl: url,
    companyName: company,
    companyWebsiteUrl: safeUrl(raw.companyUrl),
    companyCountryCode: countryCode(raw.workplace?.country),
    title,
    description: plainDescription(
      raw.contentHtml,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ),
    requirementsText: null,
    countryCode: countryCode(raw.workplace?.country),
    region: null,
    city: text(raw.workplace?.city, 120),
    workMode: raw.remoteWork === true ? 'REMOTE' : null,
    additionalLocations: [],
    remoteCountriesAllowed: [],
    employmentType: enumValue(raw.workType, EMPLOYMENT_TYPES),
    seniorityLevel: enumValue(raw.careerLevel, SENIORITY_LEVELS),
    // KRW annual figures pass through untouched — no conversion here, and no
    // Korean-specific money handling anywhere. The FX pipeline does it later.
    salaryMin: salaryAmount(raw.annualSalary?.from),
    salaryMax: salaryAmount(raw.annualSalary?.to),
    currency: currencyCode(raw.annualSalary?.currency),
    payPeriod: raw.annualSalary?.from ? 'YEARLY' : null,
    skills: [],
    industries: [],
    benefits: [],
    languageCodes: (raw.requiredLanguages ?? [])
      .map((code) => code.toLowerCase())
      .filter((code) => /^[a-z]{2,3}$/.test(code)),
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    expiresAt: timestamp(raw.closingDate),
    employerPosted: null,
    closedAtSource: raw.isClosed === true,
  };
}
