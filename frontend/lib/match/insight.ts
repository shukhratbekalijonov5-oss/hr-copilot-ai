/**
 * The ADVANCED MATCH contract, as the frontend sees it.
 *
 * These types mirror `matching/advanced/advanced-match.types.ts` on the
 * backend. They are a READING of an authoritative payload — nothing here is
 * computed, re-weighted or re-ranked in the browser. The one arithmetic this
 * file permits is turning a supplied `score`/`max` pair into a bar width,
 * which is drawing, not scoring.
 *
 * ## Every field is optional at the boundary
 *
 * A match row can arrive without an insight: an index built before the
 * advanced engine shipped still returns the legacy shape, and the list must
 * render it rather than crash. So `insight` is nullable everywhere and the
 * absence of an insight is never read as "zero" — a card with no analysis
 * shows the legacy card, not a row of noughts.
 *
 * ## "Missing" is a statement about documents, not about a person
 *
 * `MISSING` means no current evidence was found in the files and links the
 * candidate has right now. It never means the candidate cannot do the thing,
 * and no string in this product may render it that way.
 */

export const MATCH_ELIGIBILITIES = ["ELIGIBLE", "PARTIAL", "BLOCKED"] as const;
export type MatchEligibility = (typeof MATCH_ELIGIBILITIES)[number];

export interface EligibilityReason {
  code: string;
  /** Neutral, specific sentence written by the backend. Rendered verbatim. */
  detail: string;
}

export const REQUIREMENT_PRIORITIES = ["MUST_HAVE", "NICE_TO_HAVE"] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

/**
 * STRONG  — two or more independent current sources.
 * MATCH   — evidenced once, or stated on the profile.
 * PARTIAL — ambiguous, or covered only by a transferable skill.
 * MISSING — no current evidence found.
 * BLOCKED — an eligibility conflict pinned to this requirement.
 */
export const REQUIREMENT_STATUSES = [
  "STRONG",
  "MATCH",
  "PARTIAL",
  "MISSING",
  "BLOCKED",
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export type MatchEvidenceSourceKind = "FILE" | "URL" | "PROFILE";

export interface MatchEvidenceRef {
  sourceKind: MatchEvidenceSourceKind;
  fileName: string | null;
  pageNumber: number | null;
  section: string | null;
  snippet: string;
  sourceUrl: string | null;
}

export interface RequirementMatrixRow {
  requirementId: string | null;
  text: string;
  priority: RequirementPriority;
  status: RequirementStatus;
  /** The 0..1 credit this row earned. Displayed nowhere as a percentage. */
  scoreContribution: number;
  /** DISTINCT current sources supporting it, not passage count. */
  evidenceCount: number;
  evidenceRefs: MatchEvidenceRef[];
  /** Set only when a RELATED skill partially covers the row. */
  transferable: { sourceSkill: string; relation: string } | null;
  reason: string;
}

export interface MatchDimension {
  key: string;
  /** `match.dimension.<key>` — resolved against the dictionary, never shown raw. */
  labelKey: string;
  score: number;
  /** The denominator, supplied by the backend. The frontend never invents it. */
  max: number;
  normalizedScore: number;
  reason?: string;
}

export interface TransferableSkillMatch {
  sourceSkill: string;
  targetRequirement: string;
  targetSkill: string | null;
  /** Always below a direct match's credit. Related is never equal to direct. */
  credit: number;
  relation: string;
  reason: string;
  evidenceRefs: MatchEvidenceRef[];
}

export interface MatchContradiction {
  kind: string;
  /** Neutral summary from the backend. Never re-worded into an accusation. */
  summary: string;
  sourceA: string;
  sourceB: string;
  confidencePenalty: number;
}

export const CAREER_TRAJECTORY_STATUSES = [
  "STRONG",
  "ALIGNED",
  "MIXED",
  "WEAK",
  "UNKNOWN",
] as const;
export type CareerTrajectoryStatus =
  (typeof CAREER_TRAJECTORY_STATUSES)[number];

export interface CareerTrajectory {
  status: CareerTrajectoryStatus;
  /** 0..1, null when UNKNOWN. */
  score: number | null;
  reasons: string[];
}

export interface MatchScoreChange {
  /** The previous run's canonical score. Comparison metadata only. */
  previous: number;
  current: number;
  delta: number;
  reasons: string[];
}

export interface ImprovementSuggestion {
  requirementId: string | null;
  type: string;
  /** Evidence-based phrasing. Never promises a score. */
  text: string;
  /** 1 = most impactful. The list is rendered in this order. */
  impactRank: number;
}

export interface EvidenceConfidenceBreakdown {
  sources: number;
  volume: number;
  coverage: number;
  profileCompleteness: number;
  consistency: number;
}

/**
 * Evidence confidence is COVERAGE and CONSISTENCY, not probability.
 *
 * "Match 82 / Confidence 43" reads as "looks strong, on thin evidence". The
 * help text beside it says exactly that, and must never be reworded into a
 * likelihood of being hired.
 */
export interface MatchInsight {
  version: string;
  context: "CANDIDATE" | "HR";
  eligibility: MatchEligibility;
  eligibilityReasons: EligibilityReason[];
  evidenceConfidence: number;
  evidenceConfidenceBreakdown: EvidenceConfidenceBreakdown;
  dimensions: MatchDimension[];
  requirementMatrix: RequirementMatrixRow[];
  transferableSkills: TransferableSkillMatch[];
  contradictions: MatchContradiction[];
  careerTrajectory: CareerTrajectory;
  scoreChange: MatchScoreChange | null;
  improvementSuggestions: ImprovementSuggestion[];
}

/**
 * True when there is something beyond the headline worth drawing.
 *
 * Used to decide whether the advanced panel appears at all. A payload whose
 * every list is empty gets the legacy card instead of a stack of empty
 * headings — §"avoid empty decorative cards".
 */
export function hasAdvancedDetail(insight: MatchInsight | null): boolean {
  if (!insight) return false;
  return (
    insight.dimensions.length > 0 ||
    insight.requirementMatrix.length > 0 ||
    insight.transferableSkills.length > 0 ||
    insight.contradictions.length > 0 ||
    insight.improvementSuggestions.length > 0 ||
    insight.eligibilityReasons.length > 0 ||
    insight.scoreChange !== null ||
    insight.careerTrajectory.status !== "UNKNOWN"
  );
}

/** Must-have rows that are not evidenced. The HR-facing "hard gap" count. */
export function mustHaveGapCount(insight: MatchInsight | null): number {
  if (!insight) return 0;
  return insight.requirementMatrix.filter(
    (row) =>
      row.priority === "MUST_HAVE" &&
      row.status !== "STRONG" &&
      row.status !== "MATCH",
  ).length;
}
