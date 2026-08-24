import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/dictionaries/en";
import ko from "@/lib/i18n/dictionaries/ko";
import ru from "@/lib/i18n/dictionaries/ru";
import uz from "@/lib/i18n/dictionaries/uz";
import {
  countryLabel,
  formatJobLocation,
  formatSalary,
  jobProfileSections,
  languageLabel,
} from "@/lib/vacancy/job-profile";
import type { JobProfile } from "@/lib/types";

const d = en;

/** Everything unstated — a vacancy that predates the structured model. */
function unstated(overrides: Partial<JobProfile> = {}): JobProfile {
  return {
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

describe("formatSalary", () => {
  it("returns null when no salary was stated", () => {
    expect(formatSalary(unstated(), d)).toBeNull();
  });

  it("renders a full range with the currency on the last figure", () => {
    expect(
      formatSalary(
        unstated({
          salaryMin: 55_000_000,
          salaryMax: 70_000_000,
          currency: "KRW",
          payPeriod: "YEARLY",
        }),
        d,
      ),
    ).toBe("55,000,000 – 70,000,000 KRW / Yearly");
  });

  it("renders open-ended ranges as open-ended, not padded", () => {
    expect(
      formatSalary(unstated({ salaryMin: 4_000, currency: "USD" }), d),
    ).toBe("From 4,000 USD");
    expect(
      formatSalary(unstated({ salaryMax: 9_000, currency: "USD" }), d),
    ).toBe("Up to 9,000 USD");
  });

  it("groups digits with the reader's own separator", () => {
    const profile = unstated({ salaryMin: 1_234_567, currency: "UZS" });
    // Whatever each dictionary declares — never Intl, which differs between
    // Node and the browser and would break hydration.
    for (const dict of [en, ko, ru, uz]) {
      const rendered = formatSalary(profile, dict)!;
      expect(rendered).toContain(dict.datetime.groupSeparator + "234");
    }
  });
});

describe("formatJobLocation", () => {
  it("builds the structured line when the employer gave one", () => {
    expect(
      formatJobLocation({ city: "Seoul", region: null, country: "KR" }, null, d),
    ).toBe("Seoul, South Korea");
  });

  it("falls back to the legacy free-text location", () => {
    // The entire backward-compatibility story: old postings still read right.
    expect(
      formatJobLocation({ city: null, region: null, country: null }, "Seoul", d),
    ).toBe("Seoul");
  });

  it("prefers structured over legacy when both exist", () => {
    expect(
      formatJobLocation(
        { city: "Tashkent", region: null, country: "UZ" },
        "somewhere stale",
        d,
      ),
    ).toBe("Tashkent, Uzbekistan");
  });

  it("returns null when neither exists", () => {
    expect(
      formatJobLocation({ city: null, region: null, country: null }, null, d),
    ).toBeNull();
  });
});

describe("code labels", () => {
  it("translates known codes in all four locales", () => {
    expect(countryLabel("KR", en)).toBe("South Korea");
    expect(countryLabel("KR", ko)).toBe("대한민국");
    expect(countryLabel("KR", ru)).toBe("Южная Корея");
    expect(countryLabel("KR", uz)).toBe("Janubiy Koreya");
  });

  it("falls back to the code itself, stably, for anything unlisted", () => {
    // Stable in BOTH runtimes — the reason this is not Intl.DisplayNames.
    expect(countryLabel("ZZ", d)).toBe("ZZ");
    expect(languageLabel("xx", d)).toBe("XX");
  });

  it("covers every language the job form offers, in every locale", () => {
    for (const dict of [en, ko, ru, uz]) {
      for (const code of Object.keys(en.jobLanguage)) {
        expect(languageLabel(code, dict)).not.toBe(code.toUpperCase());
      }
      for (const code of Object.keys(en.country)) {
        expect(countryLabel(code, dict)).not.toBe(code);
      }
    }
  });
});

describe("section visibility", () => {
  it("hides every section for a vacancy that states nothing", () => {
    const profile = unstated();
    expect(jobProfileSections.compensation(profile)).toBe(false);
    expect(jobProfileSections.location(profile, null)).toBe(false);
    expect(jobProfileSections.workAuthorization(profile)).toBe(false);
    expect(jobProfileSections.experience(profile)).toBe(false);
    expect(jobProfileSections.education(profile)).toBe(false);
    expect(jobProfileSections.benefits(profile)).toBe(false);
    expect(jobProfileSections.timeline(profile)).toBe(false);
  });

  it("still shows the location section for a legacy free-text posting", () => {
    expect(jobProfileSections.location(unstated(), "Seoul")).toBe(true);
  });

  it("treats an UNKNOWN visa policy as nothing said", () => {
    // UNKNOWN is the stored default, so a section keyed off it would appear on
    // all 209 pre-existing vacancies saying nothing.
    expect(jobProfileSections.workAuthorization(unstated())).toBe(false);
    expect(
      jobProfileSections.workAuthorization(unstated({ visaSponsorship: "NO" })),
    ).toBe(true);
    expect(
      jobProfileSections.workAuthorization(
        unstated({ foreignApplicantsAccepted: false }),
      ),
    ).toBe(true);
  });

  it("shows compensation for a negotiable salary with no figures", () => {
    expect(
      jobProfileSections.compensation(unstated({ salaryNegotiable: true })),
    ).toBe(true);
  });
});
