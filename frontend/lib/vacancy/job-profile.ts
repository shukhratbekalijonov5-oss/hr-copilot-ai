/**
 * Rendering the structured job profile.
 *
 * Two rules run through everything here:
 *
 *  1. **Nothing is invented.** A field the employer never filled in returns
 *     `null`, and callers render "Not specified" — never a zero, a false, or a
 *     guess. `visaSponsorship: UNKNOWN` is a real answer and reads as one.
 *  2. **Codes are translated through the dictionary, not through `Intl`.**
 *     `Intl.DisplayNames` reads the host's ICU tables, and Node's and the
 *     browser's disagree for several of these locales — a difference between
 *     the server render and the hydration is a React mismatch, which this
 *     project has already been bitten by (see lib/i18n/format.ts). A code the
 *     dictionary does not list falls back to the code itself, which is stable
 *     in both runtimes.
 */
import type { Dictionary } from "@/lib/i18n/dictionary";
import { format, formatNumber } from "@/lib/i18n/format";
import type { JobProfile, VacancyLanguageRequirement } from "@/lib/types";

/** ISO 3166-1 alpha-2 → localized country name, or the code if unlisted. */
export function countryLabel(code: string, d: Dictionary): string {
  return d.country[code as keyof typeof d.country] ?? code;
}

/** BCP-47 primary subtag → localized language name, or the code if unlisted. */
export function languageLabel(code: string, d: Dictionary): string {
  return d.jobLanguage[code as keyof typeof d.jobLanguage] ?? code.toUpperCase();
}

/**
 * "55,000,000 – 70,000,000 KRW / Yearly".
 *
 * The currency code sits on the LAST number so the range reads as one amount,
 * and it is a code rather than a symbol because ₩/¥/$ are ambiguous across the
 * countries this product hires in. An open-ended range ("From …", "Up to …")
 * is a real thing employers post and is rendered as such rather than padded
 * with a fabricated bound.
 *
 * Returns null when no salary was stated — the caller shows "Not specified".
 */
export function formatSalary(
  profile: Pick<
    JobProfile,
    "salaryMin" | "salaryMax" | "currency" | "payPeriod"
  >,
  d: Dictionary,
): string | null {
  const { salaryMin, salaryMax, currency, payPeriod } = profile;
  if (salaryMin === null && salaryMax === null) return null;

  // The backend refuses a salary without a currency, so this only guards a
  // payload that predates that rule or was hand-written.
  const suffix = currency ? ` ${currency}` : "";
  const money = (value: number) => `${formatNumber(value, d)}${suffix}`;

  let amount: string;
  if (salaryMin !== null && salaryMax !== null) {
    amount = format(d.jobProfile.salaryRange, {
      min: formatNumber(salaryMin, d),
      max: money(salaryMax),
    });
  } else if (salaryMin !== null) {
    amount = format(d.jobProfile.salaryFrom, { min: money(salaryMin) });
  } else {
    amount = format(d.jobProfile.salaryUpTo, { max: money(salaryMax!) });
  }

  if (!payPeriod) return amount;
  return format(d.jobProfile.perPeriod, {
    amount,
    period: d.payPeriod[payPeriod],
  });
}

/**
 * "Seoul, South Korea" from the structured fields, falling back to the legacy
 * free-text `location`.
 *
 * The fallback is the entire backward-compatibility story for location: 208 of
 * the 209 vacancies that existed before this model have nothing but that
 * string, and they must keep rendering exactly as they did.
 */
export function formatJobLocation(
  profile: Pick<JobProfile, "city" | "region" | "country">,
  legacyLocation: string | null,
  d: Dictionary,
): string | null {
  const parts = [
    profile.city,
    profile.region,
    profile.country ? countryLabel(profile.country, d) : null,
  ].filter((part): part is string => Boolean(part && part.trim()));

  if (parts.length > 0) return parts.join(", ");
  return legacyLocation?.trim() || null;
}

/** "Korean · B1 · Required" — one line per language requirement. */
export function formatLanguageRequirement(
  requirement: VacancyLanguageRequirement,
  d: Dictionary,
): string {
  const priority = requirement.required
    ? d.jobProfile.required
    : d.jobProfile.preferred;
  return `${languageLabel(requirement.languageCode, d)} · ${d.languageLevel[requirement.level]} · ${priority}`;
}

/**
 * Whether a section has anything to say.
 *
 * A section with no stated values is HIDDEN rather than rendered as a column
 * of "Not specified" — an empty section is noise, and 209 existing vacancies
 * would otherwise each grow eight of them. "Not specified" belongs next to a
 * field the reader is already looking at, not to a whole section nobody filled
 * in.
 */
export const jobProfileSections = {
  compensation: (p: JobProfile) =>
    p.salaryMin !== null || p.salaryMax !== null || p.salaryNegotiable,

  location: (p: JobProfile, legacyLocation: string | null) =>
    Boolean(
      p.country ||
        p.region ||
        p.city ||
        p.workMode ||
        p.remoteCountriesAllowed.length > 0 ||
        legacyLocation,
    ),

  // UNKNOWN/null across the board means the employer said nothing about work
  // authorization, and a section that only says "not specified" three times is
  // worse than no section.
  workAuthorization: (p: JobProfile) =>
    p.foreignApplicantsAccepted !== null ||
    p.visaSponsorship !== "UNKNOWN" ||
    p.existingWorkAuthorizationRequired !== null ||
    p.eligibleVisaTypes.length > 0 ||
    p.citizenshipRequirement === "SPECIFIC",

  experience: (p: JobProfile) =>
    p.seniorityLevel !== null ||
    p.minExperienceYears !== null ||
    p.preferredExperienceYears !== null,

  education: (p: JobProfile) =>
    p.requiredEducation !== null ||
    p.preferredEducation !== null ||
    p.requiredCertifications.length > 0 ||
    p.preferredCertifications.length > 0 ||
    p.domainExperience.length > 0,

  benefits: (p: JobProfile) => p.benefits.length > 0,

  timeline: (p: JobProfile) =>
    p.applicationDeadline !== null ||
    p.expectedStartDate !== null ||
    p.openingsCount !== null ||
    p.hiringUrgency !== null ||
    p.contractDurationMonths !== null,
} as const;
