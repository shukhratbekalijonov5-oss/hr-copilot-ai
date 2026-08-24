import { describe, expect, it } from "vitest";
import {
  convertedSalaryLine,
  formatMoneyRange,
  matchExplanation,
  topReasons,
} from "./match-explanation";
import en from "@/lib/i18n/dictionaries/en";
import ko from "@/lib/i18n/dictionaries/ko";
import ru from "@/lib/i18n/dictionaries/ru";
import uz from "@/lib/i18n/dictionaries/uz";
import type { IntentAlignment, JobMatch } from "@/lib/types";

/**
 * The explanation a candidate reads is built from facts, not sentences a
 * model wrote. These tests pin the two properties that matter: an unknown is
 * never phrased as a fault, and a converted salary is only ever shown
 * alongside the employer's original.
 */

function match(overrides: Partial<JobMatch> = {}): JobMatch {
  return {
    vacancy: {
      slug: "backend-engineer-abc",
      title: "Backend Engineer",
      organizationName: "Acme",
      location: "Seoul",
      employmentType: "Full-time",
      status: "OPEN",
      salaryMin: 40_000_000,
      salaryMax: null,
      currency: "KRW",
      payPeriod: "YEARLY",
      salaryNegotiable: false,
      country: "KR",
      region: null,
      city: "Seoul",
      workMode: "HYBRID",
      seniorityLevel: "MID",
    },
    match: "STRONG",
    band: "GOOD",
    rank: 1,
    score: 78,
    capabilityScore: 80,
    intentScore: 70,
    alignments: [],
    signals: {},
    matchedSkills: [],
    missingSkills: [],
    explanation: null,
    supportedRequirements: [],
    unsupportedRequirements: [],
    unclearRequirements: [],
    evidence: [],
    saved: false,
    applicationState: null,
    ...overrides,
  };
}

const requirement = (text: string) => ({
  text,
  required: true,
  reason: "x",
});

function alignment(overrides: Partial<IntentAlignment>): IntentAlignment {
  return {
    dimension: "role",
    state: "MATCH",
    reason: "ROLE_EXACT",
    score: 1,
    ...overrides,
  };
}

describe("matchExplanation", () => {
  it("puts supported requirements and matched skills in 'why this matches'", () => {
    const result = matchExplanation(
      match({
        supportedRequirements: [requirement("Node.js"), requirement("SQL")],
        matchedSkills: ["node.js", "postgresql"],
      }),
      en,
    );

    expect(result.matches.map((fact) => fact.key)).toEqual([
      "capability-supported",
      "capability-skills",
    ]);
    expect(result.matches[0].text).toContain("2");
  });

  it("leads with capability, then preferences", () => {
    // 80% of the score is evidence. Leading with "matches your target role"
    // on a job whose requirements are unmet would flatter the match.
    const result = matchExplanation(
      match({
        supportedRequirements: [requirement("Node.js")],
        alignments: [alignment({})],
      }),
      en,
    );

    expect(result.matches[0].key).toBe("capability-supported");
    expect(result.matches[1].key).toBe("align-role");
  });

  it("says plainly when NOTHING was demonstrated", () => {
    const result = matchExplanation(
      match({
        supportedRequirements: [],
        unsupportedRequirements: [requirement("Rust"), requirement("Go")],
      }),
      en,
    );

    expect(result.notHigher[0].key).toBe("capability-none");
    expect(result.matches).toEqual([]);
  });

  it("MISMATCH alignments go to 'why not higher' as negatives", () => {
    const result = matchExplanation(
      match({
        alignments: [
          alignment({
            dimension: "workMode",
            state: "MISMATCH",
            reason: "WORK_MODE_MISMATCH",
            score: 0,
          }),
        ],
      }),
      en,
    );

    expect(result.notHigher).toHaveLength(1);
    expect(result.notHigher[0].tone).toBe("negative");
    expect(result.notHigher[0].text).toBe(
      en.jobMatch.matchReason.WORK_MODE_MISMATCH,
    );
  });

  it("an UNKNOWN is neutral, never a fault", () => {
    // The employer said nothing about salary. Blaming the job for that would
    // be inventing a complaint on the employer's behalf.
    const result = matchExplanation(
      match({
        alignments: [
          alignment({
            dimension: "salary",
            state: "UNKNOWN",
            reason: "SALARY_UNKNOWN",
            score: null,
          }),
        ],
      }),
      en,
    );

    expect(result.notHigher[0].tone).toBe("neutral");
    expect(result.notHigher[0].text).toBe("Salary not provided by the employer");
  });

  it("distinguishes 'employer said nothing' from 'we could not convert'", () => {
    const notComparable = matchExplanation(
      match({
        alignments: [
          alignment({
            dimension: "salary",
            state: "NOT_COMPARABLE",
            reason: "SALARY_NOT_COMPARABLE",
            score: null,
          }),
        ],
      }),
      en,
    );

    expect(notComparable.notHigher[0].text).toBe("Salary could not be compared");
    expect(notComparable.notHigher[0].text).not.toBe(
      en.jobMatch.matchReason.SALARY_UNKNOWN,
    );
  });

  it("PARTIAL argues FOR the job", () => {
    const result = matchExplanation(
      match({
        alignments: [
          alignment({
            dimension: "seniority",
            state: "PARTIAL",
            reason: "SENIORITY_ADJACENT",
            score: 0.5,
          }),
        ],
      }),
      en,
    );

    expect(result.matches[0].tone).toBe("positive");
  });

  it("skips an unrecognized reason code instead of printing it raw", () => {
    // A candidate must never be shown SALARY_PARTIAL_OVERLAP as a sentence.
    const result = matchExplanation(
      match({
        alignments: [
          alignment({ reason: "SOMETHING_NEW_FROM_A_FUTURE_VERSION" }),
        ],
      }),
      en,
    );

    expect(result.matches).toEqual([]);
    expect(result.notHigher).toEqual([]);
  });

  it("a candidate with no preferences gets capability facts only", () => {
    const result = matchExplanation(
      match({
        alignments: [],
        supportedRequirements: [requirement("Node.js")],
      }),
      en,
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].key).toBe("capability-supported");
  });
});

describe("salary presentation", () => {
  const salaryAlignment = alignment({
    dimension: "salary",
    state: "MATCH",
    reason: "SALARY_WITHIN_DESIRED_RANGE",
    score: 1,
    salary: {
      originalMin: 40_000_000,
      originalMax: null,
      originalCurrency: "KRW",
      originalPayPeriod: "YEARLY",
      convertedMin: 28_777,
      convertedMax: null,
      convertedCurrency: "USD",
      convertedPayPeriod: "YEARLY",
    },
  });

  it("shows the converted figure as an approximation", () => {
    expect(convertedSalaryLine(salaryAlignment, en)).toBe("≈ 28,777 USD / Yearly");
  });

  it("shows NO approximation when no conversion happened", () => {
    // Same currency: an "≈" line would suggest an exchange that never took
    // place.
    const sameCurrency = alignment({
      dimension: "salary",
      salary: {
        originalMin: 30_000,
        originalMax: null,
        originalCurrency: "USD",
        originalPayPeriod: "YEARLY",
        convertedMin: 30_000,
        convertedMax: null,
        convertedCurrency: "USD",
        convertedPayPeriod: "YEARLY",
      },
    });
    expect(convertedSalaryLine(sameCurrency, en)).toBeNull();
  });

  it("attaches the conversion to the salary fact, never replacing the reason", () => {
    const result = matchExplanation(
      match({ alignments: [salaryAlignment] }),
      en,
    );
    expect(result.matches[0].text).toBe(
      "Salary is within your desired range",
    );
    expect(result.matches[0].detail).toContain("28,777 USD");
  });

  it("formats a range with its currency code and period", () => {
    expect(formatMoneyRange(40_000_000, 55_000_000, "KRW", "YEARLY", en)).toBe(
      "40,000,000 – 55,000,000 KRW / Yearly",
    );
  });

  it("collapses a single-value range", () => {
    expect(formatMoneyRange(40_000_000, 40_000_000, "KRW", "YEARLY", en)).toBe(
      "40,000,000 KRW / Yearly",
    );
    expect(formatMoneyRange(null, null, "KRW", "YEARLY", en)).toBeNull();
  });
});

describe("topReasons", () => {
  it("returns positives only, capped", () => {
    const result = topReasons(
      match({
        supportedRequirements: [requirement("a")],
        matchedSkills: ["node.js"],
        alignments: [
          alignment({}),
          alignment({
            dimension: "workMode",
            state: "MISMATCH",
            reason: "WORK_MODE_MISMATCH",
            score: 0,
          }),
        ],
      }),
      en,
    );

    expect(result).toHaveLength(3);
    expect(result.every((fact) => fact.tone === "positive")).toBe(true);
  });
});

describe("four languages", () => {
  it.each([
    ["en", en],
    ["ko", ko],
    ["ru", ru],
    ["uz", uz],
  ])("%s renders every reason code with no English leaking", (locale, d) => {
    const codes = Object.keys(en.jobMatch.matchReason);
    for (const code of codes) {
      const labels = d.jobMatch.matchReason as unknown as Record<string, string>;
      expect(labels[code], `${locale} is missing ${code}`).toBeTruthy();
      if (locale !== "en") {
        expect(
          labels[code],
          `${locale}.${code} is still the English string`,
        ).not.toBe(
          (en.jobMatch.matchReason as unknown as Record<string, string>)[code],
        );
      }
    }
  });

  it.each([
    ["ko", ko],
    ["ru", ru],
    ["uz", uz],
  ])("%s localizes the band labels", (_locale, d) => {
    for (const band of ["STRONG", "GOOD", "PARTIAL", "LOW"] as const) {
      expect(d.jobMatch.band[band]).toBeTruthy();
      expect(d.jobMatch.band[band]).not.toBe(en.jobMatch.band[band]);
    }
  });
});
