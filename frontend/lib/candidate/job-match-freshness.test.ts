import { describe, expect, it } from "vitest";
import {
  canRunJobMatch,
  evidenceHint,
  isJobMatchStale,
} from "@/lib/candidate/job-match-freshness";
import type { CandidateEvidenceState, JobMatchResult } from "@/lib/types";

function evidence(
  overrides: Partial<CandidateEvidenceState> = {},
): CandidateEvidenceState {
  return {
    hasAccount: true,
    files: 1,
    links: 0,
    total: 1,
    evidenceRevision: 5,
    canRunJobMatch: true,
    ...overrides,
  };
}

function result(overrides: Partial<JobMatchResult> = {}): JobMatchResult {
  return {
    matches: [],
    locale: "en",
    generated: true,
    generatedAt: "2026-08-21T00:00:00.000Z",
    evidenceRevision: 5,
    stale: false,
    explanationsPending: false,
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
    hasMore: false,
    totalEligible: 0,
    capability: {},
    ...overrides,
  };
}

describe("can matching run at all", () => {
  it("runs on a file alone", () => {
    expect(canRunJobMatch(evidence({ files: 1, links: 0, total: 1 }))).toBe(
      true,
    );
  });

  it("runs on a LINK alone — a portfolio is evidence", () => {
    // The case the old resume-only gate got wrong: a designer with a portfolio
    // and no CV could not use job search at all.
    expect(canRunJobMatch(evidence({ files: 0, links: 1, total: 1 }))).toBe(
      true,
    );
  });

  it("runs on a mix", () => {
    expect(canRunJobMatch(evidence({ files: 2, links: 3, total: 5 }))).toBe(
      true,
    );
  });

  it("refuses with no files and no links, however complete the profile is", () => {
    // Matching reports what documents and links demonstrate. A headline is not
    // evidence, and matching on one would be invention.
    expect(canRunJobMatch(evidence({ files: 0, links: 0, total: 0 }))).toBe(
      false,
    );
  });

  it("refuses without a candidate account", () => {
    expect(canRunJobMatch(evidence({ hasAccount: false }))).toBe(false);
  });

  it("refuses when the state is unknown rather than guessing", () => {
    expect(canRunJobMatch(null)).toBe(false);
  });
});

describe("is a displayed result still current", () => {
  it("a fresh result at the current revision is not stale", () => {
    expect(isJobMatchStale(result(), evidence())).toBe(false);
  });

  it("is stale once the revision has moved on", () => {
    // The everyday case: the candidate deleted a file on another page and came
    // back to a result that describes it.
    expect(
      isJobMatchStale(result({ evidenceRevision: 5 }), evidence({ evidenceRevision: 6 })),
    ).toBe(true);
  });

  it("is stale when the backend saw evidence change mid-generation", () => {
    // A ~20s call can outlive the file it is describing; the backend says so
    // and the answer must not be published as current.
    expect(isJobMatchStale(result({ stale: true }), evidence())).toBe(true);
  });

  it("is stale even if the revision numbers happen to line up", () => {
    expect(
      isJobMatchStale(
        result({ stale: true, evidenceRevision: 5 }),
        evidence({ evidenceRevision: 5 }),
      ),
    ).toBe(true);
  });

  it("nothing displayed is never stale", () => {
    expect(isJobMatchStale(null, evidence({ evidenceRevision: 99 }))).toBe(
      false,
    );
  });

  it("an unknown evidence state does not blank out a good result", () => {
    // Failing to read the state is not evidence that the state changed.
    expect(isJobMatchStale(result(), null)).toBe(false);
  });

  it("a revision that went BACKWARDS is still a mismatch", () => {
    // Should not happen — the counter only increments — but "different" is the
    // honest test, not "greater".
    expect(
      isJobMatchStale(result({ evidenceRevision: 9 }), evidence({ evidenceRevision: 4 })),
    ).toBe(true);
  });
});

describe("which banner belongs above the results", () => {
  it("says nothing when a resume is present", () => {
    expect(evidenceHint(evidence({ files: 1, links: 0 }))).toBe("none");
    expect(evidenceHint(evidence({ files: 2, links: 2 }))).toBe("none");
  });

  it("tells a link-only candidate their links ARE being analysed", () => {
    // Not "you have no evidence" — they do, and saying otherwise is false.
    expect(evidenceHint(evidence({ files: 0, links: 2, total: 2 }))).toBe(
      "resume-improves",
    );
  });

  it("asks for a resume when there is nothing at all", () => {
    expect(evidenceHint(evidence({ files: 0, links: 0, total: 0 }))).toBe(
      "add-resume",
    );
  });

  it("says nothing while the state is unknown", () => {
    expect(evidenceHint(null)).toBe("none");
  });
});
