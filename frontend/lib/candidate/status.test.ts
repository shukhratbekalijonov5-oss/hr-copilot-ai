import { describe, expect, it } from "vitest";
import {
  CANDIDATE_STATUS_LABELS,
  isClosedForCandidate,
} from "@/lib/candidate/status";
import { APPLICATION_STATUSES } from "@/lib/types";

describe("applicant-facing status labels", () => {
  it("covers every backend status, so none can render raw", () => {
    for (const status of APPLICATION_STATUSES) {
      expect(CANDIDATE_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("does not show recruiter-internal wording to the applicant", () => {
    const labels = Object.values(CANDIDATE_STATUS_LABELS).map((l) =>
      l.toLowerCase(),
    );
    // The stored enum values themselves must never surface verbatim.
    expect(labels).not.toContain("reviewing");
    expect(labels).not.toContain("new");
    expect(CANDIDATE_STATUS_LABELS.REVIEWING).toBe("Under review");
    expect(CANDIDATE_STATUS_LABELS.REJECTED).toBe("Not selected");
  });

  it("treats decided outcomes as closed for the applicant", () => {
    expect(isClosedForCandidate("HIRED")).toBe(true);
    expect(isClosedForCandidate("REJECTED")).toBe(true);
    expect(isClosedForCandidate("WITHDRAWN")).toBe(true);
    expect(isClosedForCandidate("REVIEWING")).toBe(false);
    expect(isClosedForCandidate("NEW")).toBe(false);
  });
});
