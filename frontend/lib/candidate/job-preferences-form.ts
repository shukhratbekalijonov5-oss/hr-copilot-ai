/**
 * The job-preferences form, as pure data.
 *
 * Kept out of the React component so the rules that decide what reaches the
 * API can be tested directly. Two of them carry the weight:
 *
 *  - **"" is not 0 and not false.** The salary lives as a string and
 *    relocation as `"" | "yes" | "no"`, because `Number("")` is 0 and a
 *    defaulted `false` would turn "did not say" into "will not move".
 *  - **The API takes the COMPLETE state.** Everything the candidate has not
 *    stated is sent as an empty list or an explicit null, so what is stored is
 *    always exactly what they last confirmed — never an accumulation of edits.
 *
 * Everything checked here is also checked server-side; this exists so the
 * candidate sees the problem before the round trip, not so the server can
 * trust the client.
 */
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { FieldErrors } from "@/lib/api/errors";
import type {
  CandidateJobPreferences,
  EmploymentType,
  JobBenefit,
  JobIntentLocation,
  JobPreferencesInput,
  SeniorityLevel,
  WorkMode,
} from "@/lib/types";

/** A location row, with a stable key for the list UI. */
export interface LocationRow extends JobIntentLocation {
  key: string;
}

export interface PreferencesFormState {
  roles: string[];
  locations: LocationRow[];
  workModes: WorkMode[];
  employmentTypes: EmploymentType[];
  seniorityLevels: SeniorityLevel[];

  desiredSalaryMin: string;
  /** Optional upper end of the range. A target, never a ceiling. */
  desiredSalaryMax: string;
  salaryCurrency: string;
  payPeriod: string;

  /** `"" | "yes" | "no"` — "" is "did not say", and stays that way. */
  willingToRelocate: string;

  industries: string[];
  benefits: JobBenefit[];

  excludedCompanies: string[];
  excludedJobTitles: string[];
  excludedLocations: LocationRow[];
}

export function emptyPreferencesState(): PreferencesFormState {
  return {
    roles: [],
    locations: [],
    workModes: [],
    employmentTypes: [],
    seniorityLevels: [],
    desiredSalaryMin: "",
    desiredSalaryMax: "",
    salaryCurrency: "",
    payPeriod: "",
    willingToRelocate: "",
    industries: [],
    benefits: [],
    excludedCompanies: [],
    excludedJobTitles: [],
    excludedLocations: [],
  };
}

let rowCounter = 0;
export function newLocationRow(
  location: Partial<JobIntentLocation> = {},
): LocationRow {
  rowCounter += 1;
  return {
    key: `loc-${rowCounter}`,
    countryCode: location.countryCode ?? "",
    region: location.region ?? null,
    city: location.city ?? null,
  };
}

function toRows(locations: JobIntentLocation[]): LocationRow[] {
  return locations.map((location) => newLocationRow(location));
}

/** Hydrates the form from what the candidate has already stated. */
export function preferencesStateFrom(
  preferences: CandidateJobPreferences,
): PreferencesFormState {
  return {
    roles: [...preferences.preferredJobTitles],
    locations: toRows(preferences.preferredLocations),
    workModes: [...preferences.preferredWorkModes],
    employmentTypes: [...preferences.preferredEmploymentTypes],
    seniorityLevels: [...preferences.preferredSeniorityLevels],
    desiredSalaryMin:
      preferences.desiredSalaryMin === null
        ? ""
        : String(preferences.desiredSalaryMin),
    desiredSalaryMax:
      preferences.desiredSalaryMax === null
        ? ""
        : String(preferences.desiredSalaryMax),
    salaryCurrency: preferences.salaryCurrency ?? "",
    payPeriod: preferences.payPeriod ?? "",
    willingToRelocate:
      preferences.willingToRelocate === null
        ? ""
        : preferences.willingToRelocate
          ? "yes"
          : "no",
    industries: [...preferences.preferredIndustries],
    benefits: [...preferences.preferredBenefits],
    excludedCompanies: [...preferences.excludedCompanies],
    excludedJobTitles: [...preferences.excludedJobTitles],
    excludedLocations: toRows(preferences.excludedLocations),
  };
}

/** A whole positive number, or null when the box was left empty. */
function parseAmount(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed) || Number(trimmed) === 0) return "invalid";
  return Number(trimmed);
}

/**
 * Mirrors the server's rules exactly.
 *
 * The compensation rule is the substantive one: an amount, a currency and a
 * period are meaningful only together, because "50,000,000" cannot be compared
 * with any job's pay without knowing which currency and which period. All
 * three are required together and all three clear together.
 */
export function validatePreferencesState(
  state: PreferencesFormState,
  d: Dictionary,
): FieldErrors {
  const errors: FieldErrors = {};

  const amount = parseAmount(state.desiredSalaryMin);
  const amountMax = parseAmount(state.desiredSalaryMax);
  if (amount === "invalid") {
    errors.desiredSalaryMin = d.jobPreferences.errSalaryAmount;
  }
  if (amountMax === "invalid") {
    errors.desiredSalaryMax = d.jobPreferences.errSalaryAmount;
  }
  if (typeof amount === "number") {
    if (!state.salaryCurrency) {
      errors.salaryCurrency = d.jobPreferences.errSalaryCurrency;
    }
    if (!state.payPeriod) {
      errors.payPeriod = d.jobPreferences.errSalaryPeriod;
    }
    // Mirrors the server rule exactly, so the form never sends something the
    // API will refuse.
    if (typeof amountMax === "number" && amountMax < amount) {
      errors.desiredSalaryMax = d.jobPreferences.errSalaryRange;
    }
  } else if (
    amount === null &&
    (state.salaryCurrency || state.payPeriod || typeof amountMax === "number")
  ) {
    // A range with no floor describes nothing a job can be compared against.
    errors.desiredSalaryMin = d.jobPreferences.errSalaryAmountMissing;
  }

  // A place with no country cannot be matched against any job: "Cambridge" is
  // in England, Massachusetts and Ontario.
  const missingCountry = [...state.locations, ...state.excludedLocations].some(
    (row) => !row.countryCode,
  );
  if (missingCountry) {
    errors.locations = d.jobPreferences.errLocationCountry;
  }

  return errors;
}

/** Trims, drops blanks and removes case-insensitive duplicates. */
function normalizeEntries(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function toLocations(rows: LocationRow[]): JobIntentLocation[] {
  const seen = new Set<string>();
  const out: JobIntentLocation[] = [];
  for (const row of rows) {
    if (!row.countryCode) continue;
    const text = (value: string | null) => {
      const trimmed = value?.trim().replace(/\s+/g, " ") ?? "";
      return trimmed ? trimmed : null;
    };
    const location = {
      countryCode: row.countryCode.toUpperCase(),
      region: text(row.region),
      city: text(row.city),
    };
    const key = [
      location.countryCode,
      (location.region ?? "").toLowerCase(),
      (location.city ?? "").toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(location);
  }
  return out;
}

/**
 * Form state → the PUT body.
 *
 * Every field is always sent, because the body is the complete current state:
 * a dimension the candidate cleared has to arrive as an empty list or an
 * explicit null, or the server would keep the old value as if it were still
 * current.
 */
export function preferencesInputFrom(
  state: PreferencesFormState,
): JobPreferencesInput {
  const amount = parseAmount(state.desiredSalaryMin);
  const amountMax = parseAmount(state.desiredSalaryMax);
  const hasSalary = typeof amount === "number";

  return {
    preferredJobTitles: normalizeEntries(state.roles),
    preferredLocations: toLocations(state.locations),
    preferredWorkModes: [...new Set(state.workModes)],
    preferredEmploymentTypes: [...new Set(state.employmentTypes)],
    preferredSeniorityLevels: [...new Set(state.seniorityLevels)],
    // The whole expectation moves together, always: clearing the floor
    // clears the range, the currency and the period with it.
    desiredSalaryMin: hasSalary ? amount : null,
    desiredSalaryMax:
      hasSalary && typeof amountMax === "number" ? amountMax : null,
    salaryCurrency: hasSalary ? state.salaryCurrency : null,
    payPeriod: hasSalary
      ? (state.payPeriod as JobPreferencesInput["payPeriod"])
      : null,
    willingToRelocate:
      state.willingToRelocate === "yes"
        ? true
        : state.willingToRelocate === "no"
          ? false
          : null,
    preferredIndustries: normalizeEntries(state.industries),
    preferredBenefits: [...new Set(state.benefits)],
    excludedCompanies: normalizeEntries(state.excludedCompanies),
    excludedJobTitles: normalizeEntries(state.excludedJobTitles),
    excludedLocations: toLocations(state.excludedLocations),
  };
}

/** Whether the candidate has actually stated anything a search could act on. */
export function hasAnyPreference(state: PreferencesFormState): boolean {
  const input = preferencesInputFrom(state);
  return (
    (input.preferredJobTitles?.length ?? 0) > 0 ||
    (input.preferredLocations?.length ?? 0) > 0 ||
    (input.preferredWorkModes?.length ?? 0) > 0 ||
    (input.preferredEmploymentTypes?.length ?? 0) > 0 ||
    (input.preferredSeniorityLevels?.length ?? 0) > 0 ||
    input.desiredSalaryMin !== null ||
    input.willingToRelocate !== null ||
    (input.preferredIndustries?.length ?? 0) > 0 ||
    (input.preferredBenefits?.length ?? 0) > 0 ||
    (input.excludedCompanies?.length ?? 0) > 0 ||
    (input.excludedJobTitles?.length ?? 0) > 0 ||
    (input.excludedLocations?.length ?? 0) > 0
  );
}
