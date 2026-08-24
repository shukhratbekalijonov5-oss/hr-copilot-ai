import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/dictionaries/en";
import {
  emptyPreferencesState,
  hasAnyPreference,
  newLocationRow,
  preferencesInputFrom,
  preferencesStateFrom,
  validatePreferencesState,
  type PreferencesFormState,
} from "@/lib/candidate/job-preferences-form";
import type { CandidateJobPreferences } from "@/lib/types";

const d = en;

function state(overrides: Partial<PreferencesFormState> = {}): PreferencesFormState {
  return { ...emptyPreferencesState(), ...overrides };
}

function stored(
  overrides: Partial<CandidateJobPreferences> = {},
): CandidateJobPreferences {
  return {
    stated: true,
    preferredJobTitles: [],
    preferredLocations: [],
    preferredWorkModes: [],
    preferredEmploymentTypes: [],
    preferredSeniorityLevels: [],
    desiredSalaryMin: null,
  desiredSalaryMax: null,
    salaryCurrency: null,
    payPeriod: null,
    willingToRelocate: null,
    preferredIndustries: [],
    preferredBenefits: [],
    excludedCompanies: [],
    excludedJobTitles: [],
    excludedLocations: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("validatePreferencesState", () => {
  it("accepts an entirely empty form — stating nothing is valid", () => {
    expect(validatePreferencesState(state(), d)).toEqual({});
  });

  it("requires the units that make an amount comparable", () => {
    const errors = validatePreferencesState(
      state({ desiredSalaryMin: "50000000" }),
      d,
    );
    expect(errors.salaryCurrency).toBe(d.jobPreferences.errSalaryCurrency);
    expect(errors.payPeriod).toBe(d.jobPreferences.errSalaryPeriod);
  });

  it("accepts a complete compensation triple", () => {
    expect(
      validatePreferencesState(
        state({
          desiredSalaryMin: "50000000",
          salaryCurrency: "KRW",
          payPeriod: "YEARLY",
        }),
        d,
      ),
    ).toEqual({});
  });

  it("rejects units with no amount", () => {
    expect(
      validatePreferencesState(state({ salaryCurrency: "KRW" }), d)
        .desiredSalaryMin,
    ).toBe(d.jobPreferences.errSalaryAmountMissing);
  });

  it("rejects a non-numeric or zero salary", () => {
    expect(
      validatePreferencesState(state({ desiredSalaryMin: "lots" }), d)
        .desiredSalaryMin,
    ).toBe(d.jobPreferences.errSalaryAmount);
    expect(
      validatePreferencesState(state({ desiredSalaryMin: "0" }), d)
        .desiredSalaryMin,
    ).toBe(d.jobPreferences.errSalaryAmount);
  });

  it("rejects a place with no country", () => {
    // "Cambridge" is in England, Massachusetts and Ontario — without a country
    // it cannot be matched against any job.
    const errors = validatePreferencesState(
      state({ locations: [newLocationRow({ city: "Cambridge" })] }),
      d,
    );
    expect(errors.locations).toBe(d.jobPreferences.errLocationCountry);
  });
});

describe("preferencesInputFrom", () => {
  it("sends every dimension, so a cleared one is actually cleared", () => {
    // PUT semantics: an omitted key would leave the previous value stored and
    // still current, which is exactly what Rule N1 forbids.
    const input = preferencesInputFrom(state());

    expect(input.preferredJobTitles).toEqual([]);
    expect(input.preferredLocations).toEqual([]);
    expect(input.preferredWorkModes).toEqual([]);
    expect(input.desiredSalaryMin).toBeNull();
    expect(input.salaryCurrency).toBeNull();
    expect(input.payPeriod).toBeNull();
    expect(input.willingToRelocate).toBeNull();
    expect(input.excludedLocations).toEqual([]);
  });

  it("never turns an empty salary box into zero", () => {
    expect(preferencesInputFrom(state()).desiredSalaryMin).toBeNull();
  });

  it("never turns an unanswered relocation question into false", () => {
    expect(preferencesInputFrom(state()).willingToRelocate).toBeNull();
    expect(
      preferencesInputFrom(state({ willingToRelocate: "no" }))
        .willingToRelocate,
    ).toBe(false);
    expect(
      preferencesInputFrom(state({ willingToRelocate: "yes" }))
        .willingToRelocate,
    ).toBe(true);
  });

  it("clears the whole compensation triple when the amount goes", () => {
    const input = preferencesInputFrom(
      state({ desiredSalaryMin: "", salaryCurrency: "KRW", payPeriod: "YEARLY" }),
    );
    // A stale KRW/YEARLY with no amount would still be readable as intent.
    expect(input).toMatchObject({
      desiredSalaryMin: null,
  desiredSalaryMax: null,
      salaryCurrency: null,
      payPeriod: null,
    });
  });

  it("de-duplicates roles case-insensitively, keeping the first spelling", () => {
    const input = preferencesInputFrom(
      state({ roles: ["DevOps Engineer", "devops engineer", "  SRE "] }),
    );
    expect(input.preferredJobTitles).toEqual(["DevOps Engineer", "SRE"]);
  });

  it("normalizes and de-duplicates locations, dropping incomplete rows", () => {
    const input = preferencesInputFrom(
      state({
        locations: [
          newLocationRow({ countryCode: "kr", city: "Seoul" }),
          newLocationRow({ countryCode: "KR", city: " seoul " }),
          // No country — cannot be matched, so it is not sent.
          newLocationRow({ city: "Nowhere" }),
        ],
      }),
    );
    expect(input.preferredLocations).toEqual([
      { countryCode: "KR", region: null, city: "Seoul" },
    ]);
  });

  it("keeps preferred and excluded places in their own lists", () => {
    const input = preferencesInputFrom(
      state({
        locations: [newLocationRow({ countryCode: "KR", city: "Seoul" })],
        excludedLocations: [
          newLocationRow({
            countryCode: "US",
            region: "California",
            city: "Los Angeles",
          }),
        ],
      }),
    );
    expect(input.preferredLocations).toHaveLength(1);
    expect(input.excludedLocations).toEqual([
      { countryCode: "US", region: "California", city: "Los Angeles" },
    ]);
  });
});

describe("preferencesStateFrom", () => {
  it("hydrates everything the candidate stated", () => {
    const hydrated = preferencesStateFrom(
      stored({
        preferredJobTitles: ["DevOps Engineer", "Platform Engineer"],
        preferredLocations: [
          { countryCode: "KR", region: null, city: "Seoul" },
          { countryCode: "KR", region: null, city: "Busan" },
        ],
        preferredWorkModes: ["REMOTE", "HYBRID"],
        preferredEmploymentTypes: ["FULL_TIME"],
        preferredSeniorityLevels: ["MID", "SENIOR"],
        desiredSalaryMin: 50_000_000,
        salaryCurrency: "KRW",
        payPeriod: "YEARLY",
        willingToRelocate: true,
        preferredIndustries: ["Technology", "Fintech"],
      }),
    );

    expect(hydrated).toMatchObject({
      roles: ["DevOps Engineer", "Platform Engineer"],
      workModes: ["REMOTE", "HYBRID"],
      employmentTypes: ["FULL_TIME"],
      seniorityLevels: ["MID", "SENIOR"],
      desiredSalaryMin: "50000000",
      salaryCurrency: "KRW",
      payPeriod: "YEARLY",
      willingToRelocate: "yes",
      industries: ["Technology", "Fintech"],
    });
    expect(hydrated.locations.map((row) => row.city)).toEqual([
      "Seoul",
      "Busan",
    ]);
  });

  it("hydrates unstated values as unstated, not as no", () => {
    const hydrated = preferencesStateFrom(stored());

    expect(hydrated.desiredSalaryMin).toBe("");
    // "" and not "no": the candidate never answered.
    expect(hydrated.willingToRelocate).toBe("");
    expect(hydrated.workModes).toEqual([]);
  });

  it("keeps an explicit false distinct from unstated", () => {
    expect(
      preferencesStateFrom(stored({ willingToRelocate: false }))
        .willingToRelocate,
    ).toBe("no");
  });

  it("round-trips an edit that changes nothing", () => {
    const original = stored({
      preferredJobTitles: ["SRE"],
      preferredLocations: [
        { countryCode: "CA", region: "Ontario", city: "Toronto" },
      ],
      desiredSalaryMin: 70_000,
      salaryCurrency: "CAD",
      payPeriod: "YEARLY",
      willingToRelocate: false,
    });
    const input = preferencesInputFrom(preferencesStateFrom(original));

    expect(input).toMatchObject({
      preferredJobTitles: ["SRE"],
      preferredLocations: [
        { countryCode: "CA", region: "Ontario", city: "Toronto" },
      ],
      desiredSalaryMin: 70_000,
      salaryCurrency: "CAD",
      payPeriod: "YEARLY",
      willingToRelocate: false,
    });
  });
});

describe("hasAnyPreference", () => {
  it("is false for a blank form", () => {
    expect(hasAnyPreference(state())).toBe(false);
  });

  it("is false for rows the API would reject anyway", () => {
    // A location with no country is an unfinished edit, not a preference.
    expect(
      hasAnyPreference(state({ locations: [newLocationRow({ city: "X" })] })),
    ).toBe(false);
  });

  it("is true as soon as anything real is stated", () => {
    expect(hasAnyPreference(state({ roles: ["SRE"] }))).toBe(true);
    expect(hasAnyPreference(state({ willingToRelocate: "no" }))).toBe(true);
    expect(hasAnyPreference(state({ workModes: ["REMOTE"] }))).toBe(true);
  });
});
