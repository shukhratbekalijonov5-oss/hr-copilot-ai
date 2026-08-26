/**
 * The ADVANCED MATCH contract — the typed shape every advanced field of the
 * authoritative match response conforms to, for both presentation contexts
 * (candidate Internal AI Job Match, HR vacancy-context assessment/Compare).
 *
 * Ground rules, fixed here so every consumer can rely on them:
 *
 * - Everything in this file is DETERMINISTIC. Gemini never writes, edits or
 *   reorders any of these values; prose lives only in the separate
 *   `explanation` field.
 * - The canonical ranking `score` (match-policy.ts, v-versioned) is untouched
 *   by this contract: dimensions EXPLAIN, they do not re-rank.
 * - "No evidence found" is always a statement about the CURRENT documents and
 *   links, never a claim about the person (missing evidence ≠ absence).
 * - Rule N1: every value is computed from live current candidate data at
 *   compute time; the only historical value anywhere is
 *   `scoreChange.previous`, which is comparison METADATA — it never feeds
 *   scoring or retrieval.
 */

/** How this candidate relates to this vacancy before any weighting. */
export type MatchEligibility = 'ELIGIBLE' | 'PARTIAL' | 'BLOCKED';

export type EligibilityReasonCode =
  /** Every must-have requirement lacks current evidence. */
  | 'ALL_MUST_HAVE_EVIDENCE_MISSING'
  /** Some (not all) must-have requirements lack current evidence. */
  | 'MUST_HAVE_EVIDENCE_GAPS'
  /** A required vacancy language is not among the candidate's stated languages. */
  | 'REQUIRED_LANGUAGE_NOT_EVIDENCED'
  /** FX-comparable pay: the job's stated maximum is below the candidate's stated minimum. */
  | 'SALARY_BELOW_STATED_MINIMUM'
  /** The vacancy's work mode conflicts with every work mode the candidate stated. */
  | 'WORK_MODE_CONFLICT'
  /** The vacancy's location is outside every location the candidate stated (no relocation). */
  | 'LOCATION_CONFLICT'
  /** Stated seniority and the vacancy's seniority are incompatible. */
  | 'SENIORITY_GAP'
  /** The vacancy's employment type conflicts with every type the candidate stated. */
  | 'EMPLOYMENT_TYPE_CONFLICT'
  /** HR context only: the vacancy is not OPEN. */
  | 'VACANCY_NOT_OPEN';

export interface EligibilityReason {
  code: EligibilityReasonCode;
  /** Neutral, specific sentence. Never speculates beyond the stored facts. */
  detail: string;
}

export type RequirementPriority = 'MUST_HAVE' | 'NICE_TO_HAVE';

/**
 * STRONG   — evidenced by ≥2 independent current sources.
 * MATCH    — evidenced (single source, or profile-stated).
 * PARTIAL  — ambiguous evidence, or covered only by a TRANSFERABLE skill.
 * MISSING  — no current evidence found (NOT "the candidate cannot do this").
 * BLOCKED  — an eligibility-blocking conflict pinned to this requirement.
 */
export type RequirementMatrixStatus =
  'STRONG' | 'MATCH' | 'PARTIAL' | 'MISSING' | 'BLOCKED';

/** Where a supporting passage came from. PROFILE = the profile form itself. */
export type MatchEvidenceSourceKind = 'FILE' | 'URL' | 'PROFILE';

export interface MatchEvidenceRef {
  sourceKind: MatchEvidenceSourceKind;
  fileName: string | null;
  pageNumber: number | null;
  section: string | null;
  snippet: string;
  sourceUrl: string | null;
}

export interface RequirementMatrixRow {
  /**
   * Always null in ranking context (the index stores requirement text, not
   * ids). Reserved so HR-side views can join back to JobRequirement rows.
   */
  requirementId: string | null;
  text: string;
  priority: RequirementPriority;
  status: RequirementMatrixStatus;
  /**
   * The 0..1 credit this row earned inside its dimension
   * (STRONG 1.0 · MATCH 0.9 · PARTIAL 0.5 · TRANSFERABLE 0.45 · MISSING 0).
   */
  scoreContribution: number;
  /** DISTINCT current sources (files/links) supporting it. Anti-stuffing: repetition in one source counts once. */
  evidenceCount: number;
  evidenceRefs: MatchEvidenceRef[];
  /** Set only when a related (not identical) skill partially covers this row. */
  transferable: { sourceSkill: string; relation: string } | null;
  reason: string;
}

export type MatchDimensionKey =
  | 'mustHaveSkills'
  | 'experienceDepth'
  | 'roleSimilarity'
  | 'seniorityFit'
  | 'projectEvidence'
  | 'locationWorkMode'
  | 'languageFit'
  | 'niceToHave';

/** Fixed denominators — the frontend never invents them. Sum = 100. */
export const MATCH_DIMENSION_MAX: Record<MatchDimensionKey, number> = {
  mustHaveSkills: 30,
  experienceDepth: 20,
  roleSimilarity: 15,
  seniorityFit: 10,
  projectEvidence: 10,
  locationWorkMode: 5,
  languageFit: 5,
  niceToHave: 5,
};

export interface MatchDimension {
  key: MatchDimensionKey;
  /** i18n key: `match.dimension.<key>`. */
  labelKey: string;
  /** Integer, 0..max. Render as `${score}/${max}`. */
  score: number;
  max: number;
  /** score/max, rounded to 2 decimals. */
  normalizedScore: number;
  reason?: string;
}

export interface TransferableSkillMatch {
  /** Canonical skill the candidate HAS current evidence for. */
  sourceSkill: string;
  /** The requirement (or named technology) it partially covers. */
  targetRequirement: string;
  targetSkill: string | null;
  /** Always TRANSFERABLE_CREDIT (< 1.0): related is never equal to direct. */
  credit: number;
  /** Taxonomy group slug, e.g. `messaging`, `cloud-platform`. */
  relation: string;
  reason: string;
  evidenceRefs: MatchEvidenceRef[];
}

export type ContradictionKind = 'EXPERIENCE_YEARS_CLAIM' | 'DATE_ORDER';

export interface MatchContradiction {
  kind: ContradictionKind;
  /** Neutral: "Conflicting evidence detected …", never an accusation. */
  summary: string;
  sourceA: string;
  sourceB: string;
  /** Points subtracted from the consistency component of evidenceConfidence. */
  confidencePenalty: number;
}

export type CareerTrajectoryStatus =
  'STRONG' | 'ALIGNED' | 'MIXED' | 'WEAK' | 'UNKNOWN';

export interface CareerTrajectory {
  status: CareerTrajectoryStatus;
  /** 0..1, null when UNKNOWN. */
  score: number | null;
  reasons: string[];
}

export interface MatchScoreChange {
  /**
   * The canonical score this candidate/vacancy pair had in the PREVIOUS
   * ranking run, captured as comparison metadata at the moment the run was
   * replaced. It never participates in current scoring or retrieval (N1).
   */
  previous: number;
  current: number;
  delta: number;
  /** Requirement-level causes, e.g. "+ now evidenced: Kubernetes". */
  reasons: string[];
}

export type ImprovementSuggestionType =
  | 'ADD_MUST_HAVE_EVIDENCE'
  | 'ADD_NICE_TO_HAVE_EVIDENCE'
  | 'CLARIFY_EVIDENCE'
  | 'ADD_LANGUAGE_EVIDENCE'
  | 'ADD_INDEPENDENT_SOURCE';

export interface ImprovementSuggestion {
  requirementId: string | null;
  type: ImprovementSuggestionType;
  /** "These gaps currently reduce the match most" phrasing — never a promised score. */
  text: string;
  impactRank: number;
}

export interface EvidenceConfidenceBreakdown {
  /** 0..30 — distinct current sources (files + links). */
  sources: number;
  /** 0..20 — how much evidence text exists at all. */
  volume: number;
  /** 0..25 — how much of THIS vacancy's requirement list the evidence covers. */
  coverage: number;
  /** 0..15 — headline/summary/skills/experience/education present. */
  profileCompleteness: number;
  /** 0..10 — 10 minus contradiction penalties (floor 0). */
  consistency: number;
}

/**
 * `evidenceConfidence` is EVIDENCE COVERAGE/CONSISTENCY confidence — how much
 * current, independent, consistent material the analysis stands on. It is NOT
 * a statistical probability, NOT a hiring likelihood, and deliberately not on
 * the same scale of meaning as the match score: Match 82 / Confidence 51 means
 * "looks strong, but on thin evidence".
 */
export interface MatchInsight {
  version: 'advanced-match-v1';
  context: 'CANDIDATE' | 'HR';
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

export const ADVANCED_MATCH_VERSION = 'advanced-match-v1' as const;

/** Transferable credit: clearly below MATCH (0.9) and unclear-PARTIAL (0.5). */
export const TRANSFERABLE_CREDIT = 0.45;

/** Row credits, exported so tests and docs cite one source of truth. */
export const MATRIX_CREDITS = {
  STRONG: 1.0,
  MATCH: 0.9,
  PARTIAL: 0.5,
  TRANSFERABLE: TRANSFERABLE_CREDIT,
  MISSING: 0,
  BLOCKED: 0,
} as const;
