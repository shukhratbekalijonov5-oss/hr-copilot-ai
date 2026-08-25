import type { BadgeTone } from "@/components/ui/index";
import type { ApplicationStatus } from "@/types";

/**
 * The tone for an application stage.
 *
 * Semantic, but never the only signal: the badge always prints the stage as
 * a word, so a reader who cannot separate the hues loses nothing.
 */
export function candidateStageTone(status: ApplicationStatus): BadgeTone {
  switch (status) {
    case "NEW":
    case "REVIEWING":
      return "info";
    case "INTERVIEW":
      return "brand";
    case "OFFER":
    case "HIRED":
      return "positive";
    default:
      return "neutral";
  }
}

export type TimelineNodeState = "done" | "current" | "upcoming" | "closed";

/**
 * Applied → Review → Interview → Decision, derived from the stored status.
 *
 * The API records a status, not a stage history, so this states only what the
 * status necessarily implies: reaching Interview means Applied and Review
 * happened. No date is ever shown against a node for the same reason.
 * WITHDRAWN claims nothing beyond submission — how far it had got is not
 * recorded anywhere.
 */
const ORDER = ["applied", "review", "interview", "decision"] as const;

const REACHED: Record<ApplicationStatus, number> = {
  NEW: 0,
  REVIEWING: 1,
  INTERVIEW: 2,
  OFFER: 3,
  HIRED: 3,
  REJECTED: 3,
  WITHDRAWN: 0,
};

const CLOSED: ApplicationStatus[] = ["REJECTED", "WITHDRAWN"];

export function timelineFor(
  status: ApplicationStatus,
): { id: (typeof ORDER)[number]; state: TimelineNodeState }[] {
  const reached = REACHED[status];
  const closed = CLOSED.includes(status);

  return ORDER.map((id, index) => {
    if (index < reached) return { id, state: "done" as const };
    if (index === reached) {
      if (closed && index === ORDER.length - 1) return { id, state: "closed" as const };
      return { id, state: "current" as const };
    }
    return { id, state: closed ? ("closed" as const) : ("upcoming" as const) };
  });
}
