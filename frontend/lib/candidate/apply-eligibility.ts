import type { ApplicationStatus, MyApplication } from "@/lib/types";

/**
 * Whether this person may apply to a job right now.
 *
 * The rule that matters: a REJECTED application ends one ATTEMPT, it does not
 * end the person's relationship with the role. Asking "is there any
 * application for this job?" — which is what this screen used to ask — turns
 * a rejection into a permanent ban, so the question is instead "what is the
 * state of the LATEST attempt?".
 *
 * A candidate may now hold several applications for one vacancy, so picking
 * the newest is not a tidiness detail: an older rejected row must never mask
 * the live one, in either direction.
 *
 * This mirrors the backend, which blocks a new application only while a
 * non-REJECTED one exists. WITHDRAWN and HIRED deliberately keep blocking —
 * this change is about rejection alone.
 */

export type ApplyEligibility =
  | { kind: "never_applied"; latest: null; previousAttempts: 0 }
  /** A live attempt exists; show its stage, not an Apply button. */
  | { kind: "active"; latest: MyApplication; previousAttempts: number }
  /** Every attempt so far ended in rejection; applying again is allowed. */
  | { kind: "can_reapply"; latest: MyApplication; previousAttempts: number };

/** The one status that no longer blocks a further attempt. */
const REOPENS_APPLYING: ApplicationStatus = "REJECTED";

/**
 * Newest first.
 *
 * Ties are broken by `updatedAt` so two attempts created in the same
 * millisecond (only really possible in tests and fixtures) still order
 * deterministically rather than depending on arrival order.
 */
function newestFirst(a: MyApplication, b: MyApplication): number {
  const byCreated =
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (byCreated !== 0) return byCreated;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/** Every attempt this person has made at one job, newest first. */
export function attemptsForJob(
  applications: MyApplication[],
  publicSlug: string,
): MyApplication[] {
  return applications
    .filter((application) => application.job.publicSlug === publicSlug)
    .sort(newestFirst);
}

export function applyEligibility(
  applications: MyApplication[],
  publicSlug: string,
): ApplyEligibility {
  const attempts = attemptsForJob(applications, publicSlug);
  const latest = attempts[0];

  if (!latest) {
    return { kind: "never_applied", latest: null, previousAttempts: 0 };
  }

  return {
    kind: latest.status === REOPENS_APPLYING ? "can_reapply" : "active",
    latest,
    previousAttempts: attempts.length,
  };
}

/**
 * Whether the vacancy itself still accepts applications.
 *
 * Eligibility is the AND of "this person may apply again" and "this job is
 * still open" — being re-eligible after a rejection never reopens a closed
 * vacancy.
 */
export function jobAcceptsApplications(status: string): boolean {
  return status === "OPEN";
}
