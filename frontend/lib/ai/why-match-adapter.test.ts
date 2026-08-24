import { describe, expect, it } from "vitest";
import {
  isEmptyWhyMatch,
  toExternalWhyMatch,
} from "@/lib/api/external-jobs-adapters";
import type { ExternalWhyMatchResponse } from "@/lib/api/contracts";

/**
 * Narrowing model output before it reaches a screen.
 *
 * Everything else this codebase adapts was produced by an employer or by our
 * own ranker. This is produced by a language model: its shape is a strong
 * convention rather than a schema, and its content is untrusted in a way an
 * integer never is.
 */

const FULL: ExternalWhyMatchResponse = {
  jobId: "job-1",
  version: "external-why-match-v1",
  locale: "en",
  summary: "Your backend experience lines up closely with this role.",
  strengths: [
    { title: "Six years of Python", explanation: "The posting asks for five." },
    { title: "Payments domain", explanation: "You shipped a billing system." },
  ],
  gaps: [{ title: "No Kubernetes", explanation: "Listed as preferred." }],
  cached: true,
  generatedAt: "2026-08-24T09:00:00.000Z",
};

describe("a well-formed explanation", () => {
  it("carries summary, strengths and gaps through", () => {
    const result = toExternalWhyMatch("job-1", FULL);
    expect(result.summary).toBe(FULL.summary);
    expect(result.strengths).toHaveLength(2);
    expect(result.strengths[0]).toEqual({
      title: "Six years of Python",
      explanation: "The posting asks for five.",
    });
    expect(result.gaps).toHaveLength(1);
    expect(result.version).toBe("external-why-match-v1");
  });

  it("uses the id that was ASKED about, not the one the body claims", () => {
    // A response naming a different job would otherwise be rendered under this
    // job's title — the one mistake this panel must never make.
    const result = toExternalWhyMatch("job-1", { ...FULL, jobId: "job-999" });
    expect(result.externalJobId).toBe("job-1");
  });

  it("reads `cached` off the wire and drops it", () => {
    // Whether Redis had it is our plumbing, not a fact about this job.
    const result = toExternalWhyMatch("job-1", FULL) as unknown as Record<string, unknown>;
    expect(result.cached).toBeUndefined();
  });

  it("never produces a score, confidence or percentage", () => {
    const result = toExternalWhyMatch("job-1", {
      ...FULL,
      // Even if a backend one day sends one, the deterministic score stays the
      // only score in the product.
      ...({ score: 91, confidence: 0.8, matchPercent: 88 } as object),
    });
    const keys = Object.keys(result);
    for (const forbidden of ["score", "confidence", "matchPercent", "band", "rank"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("gaps may legitimately be empty", () => {
  it("keeps an empty list empty rather than inventing a placeholder", () => {
    const result = toExternalWhyMatch("job-1", { ...FULL, gaps: [] });
    expect(result.gaps).toEqual([]);
    // Still a real explanation — the panel renders, the gap section does not.
    expect(isEmptyWhyMatch(result)).toBe(false);
  });

  it("treats a missing or non-array gaps field the same way", () => {
    for (const gaps of [undefined, null, "none" as unknown]) {
      const result = toExternalWhyMatch("job-1", {
        ...FULL,
        gaps: gaps as ExternalWhyMatchResponse["gaps"],
      });
      expect(result.gaps).toEqual([]);
    }
  });
});

describe("malformed and hostile output", () => {
  it("drops an item with no title", () => {
    // A bullet with a blank heading is not a shorter point, it is a point with
    // nothing to point at.
    const result = toExternalWhyMatch("job-1", {
      ...FULL,
      strengths: [
        { title: "  ", explanation: "orphaned" },
        { explanation: "no title at all" },
        { title: "Real one", explanation: "kept" },
      ],
    });
    expect(result.strengths).toEqual([
      { title: "Real one", explanation: "kept" },
    ]);
  });

  it("keeps a title whose explanation is missing", () => {
    const result = toExternalWhyMatch("job-1", {
      ...FULL,
      strengths: [{ title: "Just a title" }],
    });
    expect(result.strengths).toEqual([{ title: "Just a title", explanation: "" }]);
  });

  it("caps the lists so a runaway generation cannot flood the panel", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      title: `Point ${i}`,
      explanation: "x",
    }));
    const result = toExternalWhyMatch("job-1", { ...FULL, strengths: many, gaps: many });
    expect(result.strengths.length).toBeLessThanOrEqual(6);
    expect(result.gaps.length).toBeLessThanOrEqual(6);
  });

  it("passes markup through as TEXT, unchanged and uninterpreted", () => {
    // The adapter does not sanitize, because it does not need to: every one of
    // these becomes a text node. Asserting the characters survive is asserting
    // that nothing here tries to be clever and half-escapes them instead.
    const nasty = '<img src=x onerror="alert(1)">';
    const result = toExternalWhyMatch("job-1", {
      ...FULL,
      summary: nasty,
      strengths: [{ title: nasty, explanation: "<script>bad()</script>" }],
    });
    expect(result.summary).toBe(nasty);
    expect(result.strengths[0].title).toBe(nasty);
    expect(result.strengths[0].explanation).toBe("<script>bad()</script>");
  });

  it("survives an entirely absent body", () => {
    for (const body of [null, undefined, {} as ExternalWhyMatchResponse]) {
      const result = toExternalWhyMatch("job-1", body);
      expect(result.summary).toBeNull();
      expect(result.strengths).toEqual([]);
      expect(result.gaps).toEqual([]);
      // Nothing to show: the panel reports this as unavailable rather than
      // rendering an empty box that looks like a broken feature.
      expect(isEmptyWhyMatch(result)).toBe(true);
    }
  });

  it("rejects an unusable generatedAt rather than showing an epoch", () => {
    const result = toExternalWhyMatch("job-1", { ...FULL, generatedAt: "not a date" });
    expect(result.generatedAt).toBeNull();
  });
});
