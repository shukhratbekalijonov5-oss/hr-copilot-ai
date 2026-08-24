import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/dictionaries/en";
import {
  emptyProfileState,
  profileInputFromState,
  profileStateFromVacancy,
  validateProfileState,
  type ProfileFormState,
} from "@/lib/vacancy/profile-form";
import type { Vacancy } from "@/lib/types";

const d = en;

function state(overrides: Partial<ProfileFormState> = {}): ProfileFormState {
  return { ...emptyProfileState(), ...overrides };
}

/** A vacancy with nothing structured — exactly what the 209 old rows return. */
function legacyVacancy(overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    id: "v1",
    organizationId: "org",
    title: "Frontend Engineer",
    department: "Engineering",
    location: "Seoul",
    employmentType: "Full-time",
    experienceLevel: "Mid-level",
    description: "…",
    status: "OPEN",
    createdById: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    requirements: [],
    languages: [],
    candidateCount: 0,
    requirementCount: 0,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    salaryNegotiable: false,
    country: null,
    region: null,
    city: null,
    workMode: null,
    officeDaysPerWeek: null,
    remoteCountriesAllowed: [],
    foreignApplicantsAccepted: null,
    visaSponsorship: "UNKNOWN",
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    citizenshipRequirement: "NONE",
    eligibleNationalities: [],
    seniorityLevel: null,
    minExperienceYears: null,
    preferredExperienceYears: null,
    requiredEducation: null,
    preferredEducation: null,
    requiredCertifications: [],
    preferredCertifications: [],
    domainExperience: [],
    benefits: [],
    benefitsOther: null,
    applicationDeadline: null,
    expectedStartDate: null,
    openingsCount: null,
    hiringUrgency: null,
    contractDurationMonths: null,
    ...overrides,
  };
}

describe("validateProfileState", () => {
  it("passes a completely empty form — stating nothing is valid", () => {
    expect(validateProfileState(state(), d)).toEqual({});
  });

  it("rejects a salary range that runs backwards", () => {
    const errors = validateProfileState(
      state({ salaryMin: "70000000", salaryMax: "55000000", currency: "KRW" }),
      d,
    );
    expect(errors.salaryMax).toBe(d.vacancyForm.errSalaryRange);
  });

  it("requires a currency as soon as either bound is typed", () => {
    expect(validateProfileState(state({ salaryMax: "70000000" }), d).currency).toBe(
      d.vacancyForm.errCurrencyRequired,
    );
    expect(
      validateProfileState(
        state({ salaryMax: "70000000", currency: "KRW" }),
        d,
      ).currency,
    ).toBeUndefined();
  });

  it("rejects office days beyond a week", () => {
    expect(
      validateProfileState(state({ officeDaysPerWeek: "8" }), d)
        .officeDaysPerWeek,
    ).toBe(d.vacancyForm.errOfficeDays);
    expect(
      validateProfileState(state({ officeDaysPerWeek: "2" }), d)
        .officeDaysPerWeek,
    ).toBeUndefined();
  });

  it("rejects a preferred experience below the minimum", () => {
    expect(
      validateProfileState(
        state({ minExperienceYears: "5", preferredExperienceYears: "3" }),
        d,
      ).preferredExperienceYears,
    ).toBe(d.vacancyForm.errExperienceRange);
  });

  it("rejects a citizenship restriction with no nationalities", () => {
    expect(
      validateProfileState(state({ citizenshipRequirement: "SPECIFIC" }), d)
        .eligibleNationalities,
    ).toBe(d.vacancyForm.errNationalitiesRequired);
    expect(
      validateProfileState(
        state({
          citizenshipRequirement: "SPECIFIC",
          eligibleNationalities: ["KR"],
        }),
        d,
      ).eligibleNationalities,
    ).toBeUndefined();
  });

  it("rejects two rows for the same language", () => {
    const errors = validateProfileState(
      state({
        languages: [
          { key: "a", languageCode: "ko", level: "B1", required: true },
          { key: "b", languageCode: "ko", level: "C1", required: false },
        ],
      }),
      d,
    );
    expect(errors.languages).toBe(d.vacancyForm.errDuplicateLanguage);
  });

  it("rejects a language row with nothing chosen", () => {
    const errors = validateProfileState(
      state({
        languages: [{ key: "a", languageCode: "", level: "B1", required: true }],
      }),
      d,
    );
    expect(errors.languages).toBe(d.vacancyForm.errLanguageIncomplete);
  });

  it("rejects zero openings", () => {
    expect(
      validateProfileState(state({ openingsCount: "0" }), d).openingsCount,
    ).toBe(d.vacancyForm.errOpenings);
  });
});

describe("profileInputFromState", () => {
  it("omits untouched fields when creating — nothing is invented", () => {
    const input = profileInputFromState(state(), "create");

    // A blank salary box must not become 0, and an unanswered visa question
    // must not become false.
    expect(input.salaryMin).toBeUndefined();
    expect(input.workMode).toBeUndefined();
    expect(input.foreignApplicantsAccepted).toBeUndefined();
    expect(input.openingsCount).toBeUndefined();
  });

  it("sends null for a cleared field when editing", () => {
    // The difference that lets a recruiter take back a salary they mistyped.
    const input = profileInputFromState(state(), "edit");
    expect(input.salaryMin).toBeNull();
    expect(input.workMode).toBeNull();
    expect(input.foreignApplicantsAccepted).toBeNull();
  });

  it("keeps the tri-state boolean three-valued", () => {
    expect(
      profileInputFromState(state({ foreignApplicantsAccepted: "yes" }), "create")
        .foreignApplicantsAccepted,
    ).toBe(true);
    expect(
      profileInputFromState(state({ foreignApplicantsAccepted: "no" }), "create")
        .foreignApplicantsAccepted,
    ).toBe(false);
    expect(
      profileInputFromState(state({ foreignApplicantsAccepted: "" }), "create")
        .foreignApplicantsAccepted,
    ).toBeUndefined();
  });

  it("converts numeric strings, never coercing an empty box to zero", () => {
    const input = profileInputFromState(
      state({ salaryMin: "55000000", officeDaysPerWeek: "0" }),
      "create",
    );
    expect(input.salaryMin).toBe(55_000_000);
    // 0 was TYPED, so it is a real answer and must survive.
    expect(input.officeDaysPerWeek).toBe(0);
  });

  it("drops the custom benefit text when OTHER is not selected", () => {
    const input = profileInputFromState(
      state({ benefits: ["BONUS"], benefitsOther: "Gym" }),
      "edit",
    );
    expect(input.benefitsOther).toBeNull();
  });

  it("drops unchosen language rows rather than sending blanks", () => {
    const input = profileInputFromState(
      state({
        languages: [
          { key: "a", languageCode: "ko", level: "B1", required: true },
          { key: "b", languageCode: "", level: "B2", required: false },
        ],
      }),
      "create",
    );
    expect(input.languages).toEqual([
      { languageCode: "ko", level: "B1", required: true },
    ]);
  });
});

describe("profileStateFromVacancy", () => {
  it("hydrates every stated value back into the edit form", () => {
    const hydrated = profileStateFromVacancy(
      legacyVacancy({
        salaryMin: 55_000_000,
        salaryMax: 70_000_000,
        currency: "KRW",
        payPeriod: "YEARLY",
        salaryNegotiable: true,
        country: "KR",
        city: "Seoul",
        workMode: "HYBRID",
        officeDaysPerWeek: 2,
        foreignApplicantsAccepted: true,
        visaSponsorship: "YES",
        eligibleVisaTypes: ["E-7"],
        seniorityLevel: "SENIOR",
        minExperienceYears: 5,
        preferredExperienceYears: 7,
        benefits: ["HEALTH_INSURANCE"],
        openingsCount: 2,
        hiringUrgency: "HIGH",
        applicationDeadline: "2026-09-30T00:00:00.000Z",
        languages: [{ languageCode: "ko", level: "B1", required: true }],
      }),
    );

    expect(hydrated).toMatchObject({
      salaryMin: "55000000",
      salaryMax: "70000000",
      currency: "KRW",
      payPeriod: "YEARLY",
      salaryNegotiable: true,
      country: "KR",
      city: "Seoul",
      workMode: "HYBRID",
      officeDaysPerWeek: "2",
      foreignApplicantsAccepted: "yes",
      visaSponsorship: "YES",
      eligibleVisaTypes: ["E-7"],
      seniorityLevel: "SENIOR",
      openingsCount: "2",
      hiringUrgency: "HIGH",
    });
    // An ISO timestamp has to become the yyyy-mm-dd a date input accepts.
    expect(hydrated.applicationDeadline).toBe("2026-09-30");
    expect(hydrated.languages[0]).toMatchObject({
      languageCode: "ko",
      level: "B1",
      required: true,
    });
  });

  it("hydrates a pre-structured vacancy as entirely unstated", () => {
    const hydrated = profileStateFromVacancy(legacyVacancy());

    // Every box empty, both tri-states unanswered — and crucially NOT "no".
    expect(hydrated.salaryMin).toBe("");
    expect(hydrated.workMode).toBe("");
    expect(hydrated.foreignApplicantsAccepted).toBe("");
    expect(hydrated.existingWorkAuthorizationRequired).toBe("");
    expect(hydrated.visaSponsorship).toBe("UNKNOWN");
    expect(hydrated.languages).toEqual([]);
  });

  it("round-trips an edit that changes nothing", () => {
    const vacancy = legacyVacancy({
      salaryMin: 1_000,
      salaryMax: 2_000,
      currency: "USD",
      workMode: "REMOTE",
      remoteCountriesAllowed: ["UZ", "KZ"],
    });
    const input = profileInputFromState(
      profileStateFromVacancy(vacancy),
      "edit",
    );

    expect(input).toMatchObject({
      salaryMin: 1_000,
      salaryMax: 2_000,
      currency: "USD",
      workMode: "REMOTE",
      remoteCountriesAllowed: ["UZ", "KZ"],
    });
    expect(validateProfileState(profileStateFromVacancy(vacancy), d)).toEqual({});
  });
});
