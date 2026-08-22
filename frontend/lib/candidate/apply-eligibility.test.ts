import { describe, expect, it } from "vitest";
import {
  applyEligibility,
  attemptsForJob,
  jobAcceptsApplications,
} from "@/lib/candidate/apply-eligibility";
import type { ApplicationStatus, MyApplication } from "@/lib/types";

/**
 * A rejection ends one attempt, not the candidate's chance at the role.
 * These pin the rule that used to be "any application ever ⇒ already
 * applied", which locked a rejected candidate out of the vacancy for good.
 */

function attempt(
  id: string,
  status: ApplicationStatus,
  createdAt: string,
  slug = "backend-engineer",
): MyApplication {
  return {
    id,
    status,
    source: "DIRECT",
    createdAt,
    updatedAt: createdAt,
    job: {
      publicSlug: slug,
      title: "Backend Engineer",
      location: "Tashkent",
      employmentType: "Full-time",
      organizationName: "Northwind Labs",
    },
  };
}

const SLUG = "backend-engineer";

describe("applyEligibility", () => {
  it("offers Apply when the person has never applied", () => {
    expect(applyEligibility([], SLUG)).toEqual({
      kind: "never_applied",
      latest: null,
      previousAttempts: 0,
    });
  });

  it("blocks while an attempt is live", () => {
    for (const status of [
      "NEW",
      "REVIEWING",
      "INTERVIEW",
      "OFFER",
    ] as const) {
      const result = applyEligibility(
        [attempt("a1", status, "2026-08-01T00:00:00.000Z")],
        SLUG,
      );
      expect(result.kind).toBe("active");
    }
  });

  it("allows applying again after the latest attempt was rejected", () => {
    const result = applyEligibility(
      [attempt("a1", "REJECTED", "2026-08-01T00:00:00.000Z")],
      SLUG,
    );

    expect(result.kind).toBe("can_reapply");
    expect(result.latest?.id).toBe("a1");
  });

  it("keeps WITHDRAWN and HIRED blocking — this change is about rejection only", () => {
    for (const status of ["WITHDRAWN", "HIRED"] as const) {
      expect(
        applyEligibility(
          [attempt("a1", status, "2026-08-01T00:00:00.000Z")],
          SLUG,
        ).kind,
      ).toBe("active");
    }
  });

  it("judges the NEWEST attempt, so an old rejection cannot mask a live one", () => {
    // The exact regression: attempt #1 rejected, attempt #2 live. Reading the
    // first row would offer Apply and earn a 409.
    const result = applyEligibility(
      [
        attempt("a1", "REJECTED", "2026-08-01T00:00:00.000Z"),
        attempt("a2", "NEW", "2026-08-20T00:00:00.000Z"),
      ],
      SLUG,
    );

    expect(result.kind).toBe("active");
    expect(result.latest?.id).toBe("a2");
    expect(result.previousAttempts).toBe(2);
  });

  it("is order-independent — list order must not decide eligibility", () => {
    const older = attempt("a1", "REJECTED", "2026-08-01T00:00:00.000Z");
    const newer = attempt("a2", "NEW", "2026-08-20T00:00:00.000Z");

    expect(applyEligibility([older, newer], SLUG).latest?.id).toBe("a2");
    expect(applyEligibility([newer, older], SLUG).latest?.id).toBe("a2");
  });

  it("allows re-applying when the newest of several attempts was rejected", () => {
    const result = applyEligibility(
      [
        attempt("a1", "REJECTED", "2026-07-01T00:00:00.000Z"),
        attempt("a2", "REJECTED", "2026-08-01T00:00:00.000Z"),
      ],
      SLUG,
    );

    expect(result.kind).toBe("can_reapply");
    expect(result.latest?.id).toBe("a2");
    expect(result.previousAttempts).toBe(2);
  });

  it("never reads another job's applications", () => {
    const result = applyEligibility(
      [attempt("other", "NEW", "2026-08-20T00:00:00.000Z", "frontend-engineer")],
      SLUG,
    );
    expect(result.kind).toBe("never_applied");
  });
});

describe("attemptsForJob", () => {
  it("returns every attempt newest first, preserving history", () => {
    const attempts = attemptsForJob(
      [
        attempt("a1", "REJECTED", "2026-07-01T00:00:00.000Z"),
        attempt("other", "NEW", "2026-08-05T00:00:00.000Z", "frontend-engineer"),
        attempt("a2", "NEW", "2026-08-20T00:00:00.000Z"),
      ],
      SLUG,
    );

    // Both attempts survive — a re-application must not hide the rejected one.
    expect(attempts.map((a) => a.id)).toEqual(["a2", "a1"]);
  });
});

describe("jobAcceptsApplications", () => {
  it("only an OPEN vacancy can be applied to", () => {
    expect(jobAcceptsApplications("OPEN")).toBe(true);
    // Being re-eligible after a rejection never reopens a closed vacancy.
    for (const status of ["CLOSED", "ARCHIVED", "DRAFT"]) {
      expect(jobAcceptsApplications(status)).toBe(false);
    }
  });
});
