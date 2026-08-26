import type { BadgeTone } from "@/components/ui/Badge";
import type {
  CareerTrajectoryStatus,
  MatchEligibility,
  RequirementPriority,
  RequirementStatus,
} from "@/lib/match/insight";

/**
 * How advanced-match states are DRAWN.
 *
 * Pure lookups, deliberately separate from the components, so the rule that
 * matters here can be tested without rendering anything: every state carries a
 * word and a glyph, and colour is only ever the third signal.
 *
 * §"Do not communicate MATCH/MISSING only by colour". A reader with any form
 * of colour blindness, or reading a printed page, gets the same information
 * as everyone else — the tone is decoration on top of a label they can read.
 */

export interface StatePresentation {
  tone: BadgeTone;
  /** Dictionary key for the human label. Never rendered raw. */
  labelKey: string;
  /**
   * A glyph carried alongside the label. Text, not an icon font, so it
   * survives copy-paste and screen readers announce the label beside it.
   */
  glyph: string;
}

/**
 * Requirement status.
 *
 * MISSING is deliberately `neutral`, not `critical`: an absence of current
 * evidence is not an error and not a fault, and painting it red states
 * something about the person that the data does not support. BLOCKED is the
 * only critical tone, because that is a real conflict.
 */
const REQUIREMENT_STATUS: Record<RequirementStatus, StatePresentation> = {
  STRONG: { tone: "positive", labelKey: "strong", glyph: "✓✓" },
  MATCH: { tone: "positive", labelKey: "match", glyph: "✓" },
  PARTIAL: { tone: "warning", labelKey: "partial", glyph: "~" },
  MISSING: { tone: "neutral", labelKey: "missing", glyph: "—" },
  BLOCKED: { tone: "critical", labelKey: "blocked", glyph: "!" },
};

export function requirementStatusPresentation(
  status: RequirementStatus,
): StatePresentation {
  return REQUIREMENT_STATUS[status] ?? REQUIREMENT_STATUS.MISSING;
}

const ELIGIBILITY: Record<MatchEligibility, StatePresentation> = {
  ELIGIBLE: { tone: "positive", labelKey: "eligible", glyph: "✓" },
  PARTIAL: { tone: "warning", labelKey: "partial", glyph: "~" },
  BLOCKED: { tone: "critical", labelKey: "blocked", glyph: "!" },
};

export function eligibilityPresentation(
  eligibility: MatchEligibility,
): StatePresentation {
  return ELIGIBILITY[eligibility] ?? ELIGIBILITY.ELIGIBLE;
}

const PRIORITY: Record<RequirementPriority, StatePresentation> = {
  MUST_HAVE: { tone: "brand", labelKey: "mustHave", glyph: "★" },
  NICE_TO_HAVE: { tone: "neutral", labelKey: "niceToHave", glyph: "☆" },
};

export function priorityPresentation(
  priority: RequirementPriority,
): StatePresentation {
  return PRIORITY[priority] ?? PRIORITY.NICE_TO_HAVE;
}

const TRAJECTORY: Record<CareerTrajectoryStatus, BadgeTone> = {
  STRONG: "positive",
  ALIGNED: "positive",
  MIXED: "warning",
  WEAK: "neutral",
  UNKNOWN: "neutral",
};

export function trajectoryTone(status: CareerTrajectoryStatus): BadgeTone {
  return TRAJECTORY[status] ?? "neutral";
}

/**
 * Bar width for a dimension, as a percentage string.
 *
 * This is the ONLY arithmetic the frontend performs on a score, and it is
 * drawing rather than scoring: both operands come from the backend and the
 * result never leaves the style attribute. The displayed number is always the
 * backend's `score`/`max` pair, printed verbatim.
 */
export function dimensionBarWidth(score: number, max: number): string {
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return "0%";
  const ratio = Math.min(Math.max(score / max, 0), 1);
  return `${Math.round(ratio * 100)}%`;
}

/** `+14`, `-3`, `0` — the sign is part of the meaning, so it is always shown. */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

export function deltaTone(delta: number): BadgeTone {
  if (delta > 0) return "positive";
  if (delta < 0) return "warning";
  return "neutral";
}
