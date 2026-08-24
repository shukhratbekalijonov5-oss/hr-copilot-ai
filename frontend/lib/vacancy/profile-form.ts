/**
 * The structured vacancy form, as pure data.
 *
 * Kept out of the React component so the rules that decide what reaches the
 * API can be tested directly. Three of them carry the weight:
 *
 *  - **"" is not 0 and not false.** Numbers and tri-state booleans live as
 *    strings in form state precisely so an untouched field stays untouched;
 *    `Number("")` is 0, and a 0 would advertise a salary of zero.
 *  - **Absent vs cleared.** Creating omits an empty field entirely. Editing
 *    sends `null`, because a recruiter emptying a box means "remove this",
 *    and the API distinguishes the two.
 *  - **The backend is the authority.** Everything checked here is also
 *    checked server-side; this exists so the recruiter sees the problem
 *    before the round trip, not so the server can trust the client.
 */
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { FieldErrors } from "@/lib/api/errors";
import type {
  CitizenshipRequirement,
  CreateVacancyInput,
  JobBenefit,
  LanguageProficiency,
  Vacancy,
  VisaSponsorship,
} from "@/lib/types";

export interface LanguageRow {
  key: string;
  languageCode: string;
  level: LanguageProficiency;
  required: boolean;
}

export interface ProfileFormState {
  salaryMin: string;
  salaryMax: string;
  currency: string;
  payPeriod: string;
  salaryNegotiable: boolean;

  country: string;
  region: string;
  city: string;
  workMode: string;
  officeDaysPerWeek: string;
  remoteCountriesAllowed: string[];

  foreignApplicantsAccepted: string;
  visaSponsorship: VisaSponsorship;
  existingWorkAuthorizationRequired: string;
  eligibleVisaTypes: string[];
  citizenshipRequirement: CitizenshipRequirement;
  eligibleNationalities: string[];

  seniorityLevel: string;
  minExperienceYears: string;
  preferredExperienceYears: string;

  requiredEducation: string;
  preferredEducation: string;
  requiredCertifications: string[];
  preferredCertifications: string[];
  domainExperience: string[];

  benefits: JobBenefit[];
  benefitsOther: string;

  applicationDeadline: string;
  expectedStartDate: string;
  openingsCount: string;
  hiringUrgency: string;
  contractDurationMonths: string;

  languages: LanguageRow[];
}

export function emptyProfileState(): ProfileFormState {
  return {
    salaryMin: "",
    salaryMax: "",
    currency: "",
    payPeriod: "",
    salaryNegotiable: false,
    country: "",
    region: "",
    city: "",
    workMode: "",
    officeDaysPerWeek: "",
    remoteCountriesAllowed: [],
    foreignApplicantsAccepted: "",
    visaSponsorship: "UNKNOWN",
    existingWorkAuthorizationRequired: "",
    eligibleVisaTypes: [],
    citizenshipRequirement: "NONE",
    eligibleNationalities: [],
    seniorityLevel: "",
    minExperienceYears: "",
    preferredExperienceYears: "",
    requiredEducation: "",
    preferredEducation: "",
    requiredCertifications: [],
    preferredCertifications: [],
    domainExperience: [],
    benefits: [],
    benefitsOther: "",
    applicationDeadline: "",
    expectedStartDate: "",
    openingsCount: "",
    hiringUrgency: "",
    contractDurationMonths: "",
    languages: [],
  };
}

const num = (value: number | null): string =>
  value === null || value === undefined ? "" : String(value);

/** null → "" (unstated), true → "yes", false → "no". */
const tri = (value: boolean | null): string =>
  value === null || value === undefined ? "" : value ? "yes" : "no";

/** An ISO timestamp trimmed to the `yyyy-mm-dd` an <input type="date"> wants. */
const dateInput = (value: string | null): string =>
  value ? value.slice(0, 10) : "";

/** Hydrates the edit form from a stored vacancy, losing nothing. */
export function profileStateFromVacancy(vacancy: Vacancy): ProfileFormState {
  return {
    salaryMin: num(vacancy.salaryMin),
    salaryMax: num(vacancy.salaryMax),
    currency: vacancy.currency ?? "",
    payPeriod: vacancy.payPeriod ?? "",
    salaryNegotiable: vacancy.salaryNegotiable,

    country: vacancy.country ?? "",
    region: vacancy.region ?? "",
    city: vacancy.city ?? "",
    workMode: vacancy.workMode ?? "",
    officeDaysPerWeek: num(vacancy.officeDaysPerWeek),
    remoteCountriesAllowed: [...vacancy.remoteCountriesAllowed],

    foreignApplicantsAccepted: tri(vacancy.foreignApplicantsAccepted),
    visaSponsorship: vacancy.visaSponsorship,
    existingWorkAuthorizationRequired: tri(
      vacancy.existingWorkAuthorizationRequired,
    ),
    eligibleVisaTypes: [...vacancy.eligibleVisaTypes],
    citizenshipRequirement: vacancy.citizenshipRequirement,
    eligibleNationalities: [...vacancy.eligibleNationalities],

    seniorityLevel: vacancy.seniorityLevel ?? "",
    minExperienceYears: num(vacancy.minExperienceYears),
    preferredExperienceYears: num(vacancy.preferredExperienceYears),

    requiredEducation: vacancy.requiredEducation ?? "",
    preferredEducation: vacancy.preferredEducation ?? "",
    requiredCertifications: [...vacancy.requiredCertifications],
    preferredCertifications: [...vacancy.preferredCertifications],
    domainExperience: [...vacancy.domainExperience],

    benefits: [...vacancy.benefits],
    benefitsOther: vacancy.benefitsOther ?? "",

    applicationDeadline: dateInput(vacancy.applicationDeadline),
    expectedStartDate: dateInput(vacancy.expectedStartDate),
    openingsCount: num(vacancy.openingsCount),
    hiringUrgency: vacancy.hiringUrgency ?? "",
    contractDurationMonths: num(vacancy.contractDurationMonths),

    languages: vacancy.languages.map((language, index) => ({
      key: `lang-${language.languageCode}-${index}`,
      languageCode: language.languageCode,
      level: language.level,
      required: language.required,
    })),
  };
}

/** A whole non-negative number, or null when the field was left alone. */
function parseCount(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  return Number(trimmed);
}

/**
 * What the recruiter can see is wrong before sending.
 *
 * Mirrors the server's cross-field rules exactly — same comparisons, same
 * conditions — so the two can never disagree about whether a vacancy is
 * valid. The server still re-checks everything.
 */
export function validateProfileState(
  state: ProfileFormState,
  d: Dictionary,
): FieldErrors {
  const errors: FieldErrors = {};

  const min = parseCount(state.salaryMin);
  const max = parseCount(state.salaryMax);
  if (min === "invalid") errors.salaryMin = d.vacancyForm.errSalaryRange;
  if (max === "invalid") errors.salaryMax = d.vacancyForm.errSalaryRange;
  if (typeof min === "number" && typeof max === "number" && min > max) {
    errors.salaryMax = d.vacancyForm.errSalaryRange;
  }
  if ((min !== null || max !== null) && !state.currency) {
    errors.currency = d.vacancyForm.errCurrencyRequired;
  }

  const office = parseCount(state.officeDaysPerWeek);
  if (
    office === "invalid" ||
    (typeof office === "number" && office > 7)
  ) {
    errors.officeDaysPerWeek = d.vacancyForm.errOfficeDays;
  }

  const minExp = parseCount(state.minExperienceYears);
  const prefExp = parseCount(state.preferredExperienceYears);
  if (minExp === "invalid") {
    errors.minExperienceYears = d.vacancyForm.errExperienceRange;
  }
  if (prefExp === "invalid") {
    errors.preferredExperienceYears = d.vacancyForm.errExperienceRange;
  }
  if (
    typeof minExp === "number" &&
    typeof prefExp === "number" &&
    prefExp < minExp
  ) {
    errors.preferredExperienceYears = d.vacancyForm.errExperienceRange;
  }

  if (
    state.citizenshipRequirement === "SPECIFIC" &&
    state.eligibleNationalities.length === 0
  ) {
    errors.eligibleNationalities = d.vacancyForm.errNationalitiesRequired;
  }

  const openings = parseCount(state.openingsCount);
  if (openings === "invalid" || openings === 0) {
    errors.openingsCount = d.vacancyForm.errOpenings;
  }

  const contract = parseCount(state.contractDurationMonths);
  if (contract === "invalid" || contract === 0) {
    errors.contractDurationMonths = d.vacancyForm.errContractDuration;
  }

  // Language rows: an unchosen row is an unfinished edit, and two rows for one
  // language are a contradiction the database also refuses.
  if (state.languages.some((row) => !row.languageCode)) {
    errors.languages = d.vacancyForm.errLanguageIncomplete;
  } else {
    const codes = state.languages.map((row) => row.languageCode);
    if (new Set(codes).size !== codes.length) {
      errors.languages = d.vacancyForm.errDuplicateLanguage;
    }
  }

  return errors;
}

type Mode = "create" | "edit";

/**
 * Form state → API payload.
 *
 * `mode` decides what an empty field means. On create it means "never stated",
 * so the key is omitted. On edit it means "clear this", so an explicit null is
 * sent — otherwise a recruiter could set a salary but never take it back.
 */
export function profileInputFromState(
  state: ProfileFormState,
  mode: Mode,
): Partial<CreateVacancyInput> {
  const cleared = mode === "edit" ? null : undefined;

  const text = (value: string) => (value.trim() ? value.trim() : cleared);
  const count = (value: string) => {
    const parsed = parseCount(value);
    return typeof parsed === "number" ? parsed : cleared;
  };
  const triState = (value: string) =>
    value === "yes" ? true : value === "no" ? false : cleared;
  const date = (value: string) => (value ? value : cleared);

  return {
    salaryMin: count(state.salaryMin),
    salaryMax: count(state.salaryMax),
    currency: text(state.currency),
    payPeriod: text(state.payPeriod) as CreateVacancyInput["payPeriod"],
    salaryNegotiable: state.salaryNegotiable,

    country: text(state.country),
    region: text(state.region),
    city: text(state.city),
    workMode: text(state.workMode) as CreateVacancyInput["workMode"],
    officeDaysPerWeek: count(state.officeDaysPerWeek),
    remoteCountriesAllowed: state.remoteCountriesAllowed,

    foreignApplicantsAccepted: triState(state.foreignApplicantsAccepted),
    visaSponsorship: state.visaSponsorship,
    existingWorkAuthorizationRequired: triState(
      state.existingWorkAuthorizationRequired,
    ),
    eligibleVisaTypes: state.eligibleVisaTypes,
    citizenshipRequirement: state.citizenshipRequirement,
    eligibleNationalities: state.eligibleNationalities,

    seniorityLevel: text(state.seniorityLevel) as CreateVacancyInput["seniorityLevel"],
    minExperienceYears: count(state.minExperienceYears),
    preferredExperienceYears: count(state.preferredExperienceYears),

    requiredEducation: text(
      state.requiredEducation,
    ) as CreateVacancyInput["requiredEducation"],
    preferredEducation: text(
      state.preferredEducation,
    ) as CreateVacancyInput["preferredEducation"],
    requiredCertifications: state.requiredCertifications,
    preferredCertifications: state.preferredCertifications,
    domainExperience: state.domainExperience,

    benefits: state.benefits,
    benefitsOther: state.benefits.includes("OTHER")
      ? text(state.benefitsOther)
      : cleared,

    applicationDeadline: date(state.applicationDeadline),
    expectedStartDate: date(state.expectedStartDate),
    openingsCount: count(state.openingsCount),
    hiringUrgency: text(state.hiringUrgency) as CreateVacancyInput["hiringUrgency"],
    contractDurationMonths: count(state.contractDurationMonths),

    languages: state.languages
      .filter((row) => row.languageCode)
      .map((row) => ({
        languageCode: row.languageCode,
        level: row.level,
        required: row.required,
      })),
  };
}
