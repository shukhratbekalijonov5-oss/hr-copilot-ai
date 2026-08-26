/**
 * HR-side advanced match contracts: the vacancy-context candidate assessment
 * and the Compare intelligence summary. Both are produced by the SAME engine
 * as the candidate's Internal AI Job Match (`matching/advanced`), with the
 * candidate's private preferences excluded — HR sees evidence-derived
 * analysis only, never the candidate's stated salary, locations or exclusions.
 */

import type { MatchInsight } from '../matching/advanced/advanced-match.types';

export interface HrMatchInsightResponse {
  candidate: { id: string; fullName: string };
  vacancy: { id: string; title: string; status: string };
  /**
   * Canonical capability score for this pair (0-100). With no intent in play
   * (HR context) the canonical score IS the capability score. Orders and
   * explains; it is not a probability of being hired.
   */
  score: number;
  capabilityScore: number;
  /** STRONG | PARTIAL | WEAK — capability tier, same vocabulary as the list. */
  tier: string;
  /** STRONG | GOOD | PARTIAL | LOW — canonical band, same policy as the list. */
  band: string;
  matchedSkills: string[];
  missingSkills: string[];
  insight: MatchInsight;
  generatedAt: string;
}

export interface CompareInsightCandidate {
  candidateId: string;
  fullName: string;
  /** Null when this candidate could not be assessed (see `error`). */
  score: number | null;
  band: string | null;
  eligibility: MatchInsight['eligibility'] | null;
  evidenceConfidence: number | null;
  /** MUST_HAVE matrix rows that are not STRONG/MATCH. */
  mustHaveGapCount: number | null;
  dimensions: MatchInsight['dimensions'];
  /** NO_CANDIDATE_EVIDENCE | CANDIDATE_NOT_IN_VACANCY | MATCH_INDEX_PENDING */
  error: string | null;
}

export interface CompareSuperlative {
  candidateId: string;
  fullName: string;
  /** The deterministic figure that decided it — never a model's opinion. */
  value: number;
}

export interface CompareInsightsResponse {
  vacancy: { id: string; title: string; status: string };
  candidates: CompareInsightCandidate[];
  /**
   * Deterministic winners, each pinned to the underlying number. Null when
   * fewer than two candidates could be assessed on that measure.
   */
  superlatives: {
    bestTechnicalMatch: CompareSuperlative | null;
    bestSeniorityFit: CompareSuperlative | null;
    fewestMustHaveGaps: CompareSuperlative | null;
    highestEvidenceConfidence: CompareSuperlative | null;
  };
  generatedAt: string;
}
