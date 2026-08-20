import { ApiError } from "@/lib/api/errors";
import type { CandidateActionReason } from "@/lib/types";

/**
 * Turns a backend failure on a candidate-platform route into a reason the UI
 * has words for.
 *
 * The distinctions are the ones a person can act on: create a profile, upload a
 * resume, or accept that this application already exists. Collapsing them into
 * one error would leave the reader without a next step.
 *
 * The status codes come from the documented contract:
 *   400 — no candidate account yet
 *   422 — no resume on the profile
 *   409 — duplicate application, or a withdraw from a terminal stage
 *   404 — unknown or non-OPEN job, and every cross-account probe
 */
export function candidateFailureReason(
  error: unknown,
): CandidateActionReason {
  if (!(error instanceof ApiError)) return "error";
  if (error.kind === "network") return "network";

  switch (error.status) {
    case 400:
      return "no_candidate_account";
    case 422:
      return "no_resume";
    case 409:
      return "already_applied";
    case 404:
      return "job_unavailable";
    case 401:
      return "unauthorized";
    default:
      return "error";
  }
}
