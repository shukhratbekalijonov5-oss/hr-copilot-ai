import type { ApplicationStatus } from "@/lib/types";

/**
 * One application's position along Applied → Review → Interview → Decision.
 *
 * ## Derived from the current status alone
 *
 * The API records a status, not a stage history, so this states only what
 * the status necessarily implies: reaching Interview means Applied and
 * Review happened. That is an ordering fact about the enum, not a guess
 * about dates — and no date is ever shown against a node for exactly that
 * reason.
 *
 * ## Withdrawn and rejected are different endings
 *
 * REJECTED closes the decision node: the employer decided. WITHDRAWN closes
 * it too, but the reached stages stop wherever the candidate left — there is
 * no record of how far it had got, so nothing beyond Applied is claimed.
 */
export type TimelineNodeState = "done" | "current" | "upcoming" | "closed";

export interface TimelineNode {
  id: "applied" | "review" | "interview" | "decision";
  state: TimelineNodeState;
}

const ORDER = ["applied", "review", "interview", "decision"] as const;

/** How far each status has demonstrably reached. -1 for none. */
const REACHED: Record<ApplicationStatus, number> = {
  NEW: 0,
  REVIEWING: 1,
  INTERVIEW: 2,
  OFFER: 3,
  HIRED: 3,
  REJECTED: 3,
  // The candidate ended it; only submission is certain.
  WITHDRAWN: 0,
};

const CLOSED_AT_DECISION: ApplicationStatus[] = ["REJECTED", "WITHDRAWN"];

export function timelineFor(status: ApplicationStatus): TimelineNode[] {
  const reached = REACHED[status];
  const closed = CLOSED_AT_DECISION.includes(status);

  return ORDER.map((id, index) => {
    if (index < reached) return { id, state: "done" as const };
    if (index === reached) {
      // The final node of a closed application is an ending, not a position.
      if (closed && index === ORDER.length - 1) {
        return { id, state: "closed" as const };
      }
      return { id, state: "current" as const };
    }
    if (closed) return { id, state: "closed" as const };
    return { id, state: "upcoming" as const };
  });
}
