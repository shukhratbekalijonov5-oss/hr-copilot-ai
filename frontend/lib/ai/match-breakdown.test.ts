import { describe, expect, it } from "vitest";
import {
  isEmptyMatchBreakdown,
  toExternalMatchBreakdown,
} from "@/lib/api/external-jobs-adapters";
import {
  breakdownDimensionLabel,
  breakdownStatusTone,
  isStatedStatus,
} from "@/lib/ai/match-breakdown";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import { MATCH_BREAKDOWN_STATUSES } from "@/lib/types";
import type { ExternalMatchBreakdownResponse } from "@/lib/api/contracts";

/** Exactly the keys `match-breakdown.dimensions.ts` can emit. */
const BACKEND_DIMENSION_KEYS = [
  "skills",
  "seniority",
  "workMode",
  "employmentType",
  "location",
  "salary",
  "languages",
] as const;

const FULL: ExternalMatchBreakdownResponse = {
  jobId: "job-1",
  version: "external-match-breakdown-v1",
  locale: "en",
  summary: "A close fit on engineering, less so on location.",
  dimensions: [
    {
      key: "SKILLS",
      label: "Skills",
      status: "STRONG",
      explanation: "Most of the stack overlaps.",
      matched: ["Node.js", "PostgreSQL"],
      missing: ["Kubernetes"],
    },
    {
      key: "LOCATION",
      label: "Location",
      status: "PARTIAL",
      explanation: "On-site in New York.",
      matched: [],
      missing: [],
    },
    {
      key: "SALARY",
      label: "Salary",
      status: "UNKNOWN",
      explanation: "The employer published no pay range.",
      matched: [],
      missing: [],
    },
    {
      key: "WORK_AUTH",
      label: "Work authorization",
      status: "GAP",
      explanation: "Requires existing US work authorization.",
      matched: [],
      missing: ["US work authorization"],
    },
  ],
  cached: false,
  generatedAt: "2026-08-24T09:00:00.000Z",
};

describe("a well-formed breakdown", () => {
  it("carries the summary and every dimension through", () => {
    const result = toExternalMatchBreakdown("job-1", FULL);
    expect(result.summary).toBe(FULL.summary);
    expect(result.dimensions).toHaveLength(4);
    expect(result.dimensions.map((dimension) => dimension.status)).toEqual([
      "STRONG",
      "PARTIAL",
      "UNKNOWN",
      "GAP",
    ]);
    expect(result.version).toBe("external-match-breakdown-v1");
    expect(isEmptyMatchBreakdown(result)).toBe(false);
  });

  it("keeps matched and missing as separate lists", () => {
    const [skills] = toExternalMatchBreakdown("job-1", FULL).dimensions;
    expect(skills.matched).toEqual(["Node.js", "PostgreSQL"]);
    expect(skills.missing).toEqual(["Kubernetes"]);
  });

  it("allows both lists to be empty", () => {
    // An UNKNOWN dimension has no evidence either way, and a STRONG one often
    // has nothing missing. Both render as no list rather than an empty box.
    const salary = toExternalMatchBreakdown("job-1", FULL).dimensions[2];
    expect(salary.matched).toEqual([]);
    expect(salary.missing).toEqual([]);
  });

  it("uses the id asked about, not the one the body claims", () => {
    expect(
      toExternalMatchBreakdown("job-1", { ...FULL, jobId: "job-999" }).externalJobId,
    ).toBe("job-1");
  });

  it("drops the cache flag", () => {
    const result = toExternalMatchBreakdown("job-1", FULL) as unknown as Record<
      string,
      unknown
    >;
    expect(result.cached).toBeUndefined();
  });

  it("produces no score, weight or percentage even if one is sent", () => {
    const result = toExternalMatchBreakdown("job-1", {
      ...FULL,
      ...({ score: 82, overallPercent: 0.82 } as object),
      dimensions: [{ ...FULL.dimensions![0], ...({ weight: 0.4, rating: 9 } as object) }],
    });
    for (const forbidden of ["score", "overallPercent", "percent", "band"]) {
      expect(Object.keys(result)).not.toContain(forbidden);
    }
    for (const forbidden of ["weight", "rating", "score", "percent"]) {
      expect(Object.keys(result.dimensions[0])).not.toContain(forbidden);
    }
  });
});

describe("UNKNOWN is never turned into a gap", () => {
  it("reads an unrecognised status as UNKNOWN, not GAP", () => {
    // A status we cannot parse is a parsing failure of ours. Reading it as a
    // gap would invent a shortcoming in the reader's profile out of it.
    for (const status of ["MAYBE", "", null, undefined, 3, "gap"]) {
      const result = toExternalMatchBreakdown("job-1", {
        ...FULL,
        dimensions: [{ key: "X", label: "X", status: status as string }],
      });
      expect(result.dimensions[0].status, String(status)).toBe("UNKNOWN");
    }
  });

  it("gives UNKNOWN a neutral tone, never a warning one", () => {
    // Warning is what GAP wears. If UNKNOWN wore it too, every unpublished
    // field in a job posting would read as a mark against the reader.
    expect(breakdownStatusTone("UNKNOWN")).toBe("neutral");
    expect(breakdownStatusTone("GAP")).toBe("warning");
    expect(breakdownStatusTone("UNKNOWN")).not.toBe(breakdownStatusTone("GAP"));
  });

  it("never uses the error tone for any status", () => {
    // A gap is an ordinary fact about a job application, not a failure.
    for (const status of MATCH_BREAKDOWN_STATUSES) {
      expect(breakdownStatusTone(status), status).not.toBe("critical");
    }
  });

  it("gives every status a distinct, defined tone for the stated three", () => {
    expect(breakdownStatusTone("STRONG")).toBe("positive");
    expect(breakdownStatusTone("PARTIAL")).toBe("info");
    const tones = MATCH_BREAKDOWN_STATUSES.map(breakdownStatusTone);
    expect(new Set(tones).size).toBe(4);
  });

  it("marks UNKNOWN as the one status that asserts nothing", () => {
    expect(isStatedStatus("UNKNOWN")).toBe(false);
    for (const status of ["STRONG", "PARTIAL", "GAP"] as const) {
      expect(isStatedStatus(status), status).toBe(true);
    }
  });
});

describe("malformed and hostile output", () => {
  it("drops a dimension with no label rather than showing its key", () => {
    // `SKILLS` on screen is a machine token leaking into every locale at once.
    const result = toExternalMatchBreakdown("job-1", {
      ...FULL,
      dimensions: [
        { key: "SKILLS", status: "STRONG" },
        { key: "X", label: "   ", status: "GAP" },
        { key: "OK", label: "Location", status: "PARTIAL" },
      ],
    });
    expect(result.dimensions).toHaveLength(1);
    expect(result.dimensions[0].label).toBe("Location");
  });

  it("falls back to the label for the react key when none is sent", () => {
    const result = toExternalMatchBreakdown("job-1", {
      ...FULL,
      dimensions: [{ label: "Skills", status: "STRONG" }],
    });
    expect(result.dimensions[0].key).toBe("Skills");
  });

  it("drops blank bullets and caps long lists", () => {
    const result = toExternalMatchBreakdown("job-1", {
      ...FULL,
      dimensions: [
        {
          key: "S",
          label: "Skills",
          status: "STRONG",
          matched: ["  ", "Node.js", "", ...Array.from({ length: 40 }, (_, i) => `x${i}`)],
          missing: [null, 7, "Kubernetes"] as unknown as string[],
        },
      ],
    });
    expect(result.dimensions[0].matched.length).toBeLessThanOrEqual(12);
    expect(result.dimensions[0].matched).toContain("Node.js");
    expect(result.dimensions[0].matched).not.toContain("");
    expect(result.dimensions[0].missing).toEqual(["Kubernetes"]);
  });

  it("caps the number of dimensions", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      key: `K${i}`,
      label: `Dimension ${i}`,
      status: "STRONG",
    }));
    expect(
      toExternalMatchBreakdown("job-1", { ...FULL, dimensions: many }).dimensions.length,
    ).toBeLessThanOrEqual(10);
  });

  it("passes markup through as text", () => {
    const nasty = '<img src=x onerror="alert(1)">';
    const result = toExternalMatchBreakdown("job-1", {
      ...FULL,
      summary: nasty,
      dimensions: [
        { key: "S", label: nasty, status: "STRONG", explanation: nasty, matched: [nasty] },
      ],
    });
    expect(result.summary).toBe(nasty);
    expect(result.dimensions[0].label).toBe(nasty);
    expect(result.dimensions[0].matched[0]).toBe(nasty);
  });

  it("treats a summary with no dimensions as nothing", () => {
    // It would render as a heading and a paragraph where a table was promised.
    const result = toExternalMatchBreakdown("job-1", { ...FULL, dimensions: [] });
    expect(isEmptyMatchBreakdown(result)).toBe(true);
  });

  it("survives an absent body", () => {
    for (const body of [null, undefined, {} as ExternalMatchBreakdownResponse]) {
      const result = toExternalMatchBreakdown("job-1", body);
      expect(result.dimensions).toEqual([]);
      expect(result.summary).toBeNull();
      expect(isEmptyMatchBreakdown(result)).toBe(true);
    }
  });
});

describe("dimension labels reach the reader in their own language", () => {
  it("translates every dimension the backend actually emits", () => {
    // The backend hardcodes these labels in English and has no translation
    // layer for user-facing strings, so a Korean reader was getting Korean
    // prose under English row headings.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const key of BACKEND_DIMENSION_KEYS) {
        const label = breakdownDimensionLabel(key, "SHOULD NOT BE USED", dictionary);
        expect(label, `${locale}.${key}`).toBeTruthy();
        expect(label, `${locale}.${key}`).not.toBe("SHOULD NOT BE USED");
      }
    }
  });

  it("falls back to the backend's own label for a dimension it does not know", () => {
    // A new backend dimension still appears, named by whoever added it —
    // never blank, and never as a raw key.
    for (const { dictionary } of ALL_DICTIONARIES) {
      expect(breakdownDimensionLabel("visaSponsorship", "Visa sponsorship", dictionary)).toBe(
        "Visa sponsorship",
      );
    }
  });

  it("gives every dimension a distinct name per locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const labels = BACKEND_DIMENSION_KEYS.map((key) =>
        breakdownDimensionLabel(key, "x", dictionary),
      );
      expect(new Set(labels).size, locale).toBe(BACKEND_DIMENSION_KEYS.length);
    }
  });

  it("localises away from English in the non-English locales", () => {
    // The bug this fixes was English leaking into three locales; assert the
    // fix actually took, rather than that a key merely resolves.
    const english = ALL_DICTIONARIES.find((entry) => entry.locale === "en")!.dictionary;
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      if (locale === "en") continue;
      for (const key of BACKEND_DIMENSION_KEYS) {
        expect(
          breakdownDimensionLabel(key, "x", dictionary),
          `${locale}.${key} is still English`,
        ).not.toBe(breakdownDimensionLabel(key, "x", english));
      }
    }
  });
});
