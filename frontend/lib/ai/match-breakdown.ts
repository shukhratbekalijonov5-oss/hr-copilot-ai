import type { BadgeTone } from "@/components/ui/Badge";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { MatchBreakdownStatus } from "@/lib/types";

/**
 * How each dimension status is presented — as data, so it can be tested.
 *
 * ## The distinction this file exists to protect
 *
 * `GAP` and `UNKNOWN` are different claims about the world and must never look
 * alike. A gap says we looked and the thing is missing. UNKNOWN says nobody
 * stated it — an employer who did not publish a salary has not published a bad
 * one, and a candidate whose profile is silent on a language has not failed a
 * language requirement.
 *
 * Rendering UNKNOWN in a warning tone would turn every unpublished field in a
 * job posting into a mark against the reader. So it is neutral, and its label
 * says "not enough information" rather than anything that sounds like a
 * verdict.
 *
 * ## Why none of these is `critical`
 *
 * `critical` is this design system's error tone. A gap is not an error — it is
 * an ordinary and often unimportant fact about a job application, and dressing
 * it in the colour reserved for failures would tell a reader that a missing
 * nice-to-have is something broken.
 */
const TONES: Record<MatchBreakdownStatus, BadgeTone> = {
  STRONG: "positive",
  PARTIAL: "info",
  GAP: "warning",
  UNKNOWN: "neutral",
};

export function breakdownStatusTone(status: MatchBreakdownStatus): BadgeTone {
  return TONES[status];
}

/**
 * True only for statuses that assert something about the reader.
 *
 * UNKNOWN asserts nothing, so it gets no emphasis anywhere — no accent border,
 * no icon, no ordering preference.
 */
export function isStatedStatus(status: MatchBreakdownStatus): boolean {
  return status !== "UNKNOWN";
}

/* -------------------------------------------------------------------------- */
/* Dimension labels                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The dimension keys the backend emits, and their translated names.
 *
 * ## Why this exists, having previously argued it should not
 *
 * The adapter deliberately renders the backend's `label` and refuses to map
 * `key` through a dictionary — on the reasoning that the keys are the
 * backend's and open-ended, so any mapping here would silently miss new ones.
 *
 * The first live response disproved the premise. The keys are a CLOSED set of
 * seven, fixed in `match-breakdown.dimensions.ts`, and the labels beside them
 * are hardcoded English constants. The backend has no translation layer for
 * user-facing strings — it sends English to Gemini and lets the model write
 * the prose in the requested locale — so a Korean reader was getting Korean
 * summaries and explanations under rows headed "Work mode" and "Salary".
 *
 * So the key IS translated, for the seven that exist, and anything else falls
 * back to the backend's own label. That keeps the original safeguard intact —
 * a new dimension still appears, named by whoever added it — while fixing the
 * three locales that were reading half-English tables.
 */
const DIMENSION_LABEL_KEYS = [
  "skills",
  "seniority",
  "workMode",
  "employmentType",
  "location",
  "salary",
  "languages",
] as const;

type DimensionLabelKey = (typeof DIMENSION_LABEL_KEYS)[number];

function isKnownDimensionKey(key: string): key is DimensionLabelKey {
  return (DIMENSION_LABEL_KEYS as readonly string[]).includes(key);
}

/**
 * The row's heading in the reader's language.
 *
 * `fallback` is the backend's own label, used verbatim for any dimension this
 * build does not know. That is the honest default: it is real display text the
 * backend chose, not a machine key, so an unrecognised dimension degrades to
 * "correct but untranslated" rather than to a blank row or a raw token.
 */
export function breakdownDimensionLabel(
  key: string,
  fallback: string,
  d: Dictionary,
): string {
  return isKnownDimensionKey(key) ? d.matchBreakdown.dimensions[key] : fallback;
}
