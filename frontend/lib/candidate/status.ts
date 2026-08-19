import type { ApplicationStatus } from "@/lib/types";

/**
 * Applicant-facing wording for application stages.
 *
 * The stored value is the backend's enum and stays the source of truth; this is
 * only how it reads to the person who applied. Recruiter-internal phrasing —
 * and anything about other applicants — never crosses to this side.
 */
export const CANDIDATE_STATUS_LABELS: Record<ApplicationStatus, string> = {
  NEW: "Submitted",
  REVIEWING: "Under review",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Not selected",
  WITHDRAWN: "Withdrawn",
};

/** Stages after which an applicant can no longer act on the application. */
export const CLOSED_STATUSES: ApplicationStatus[] = [
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
];

export function isClosedForCandidate(status: ApplicationStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}
