import type { MatchDimension, MatchEligibility, MatchInsight } from "@/lib/match/insight";

/**
 * The HR-side shapes: one vacancy-context assessment, and the Compare summary.
 *
 * Both wrap the SAME `MatchInsight` the candidate sees. The difference is
 * audience, not analysis — the backend computes one engine's output and omits
 * the candidate's private preferences from the HR context, so nothing here
 * needs to hide anything and nothing here may add anything.
 */

export interface HrMatchInsight {
  candidate: { id: string; fullName: string };
  vacancy: { id: string; title: string; status: string };
  /** Canonical capability score for this pair. Orders and explains; not a probability. */
  score: number;
  capabilityScore: number;
  tier: string;
  band: string;
  matchedSkills: string[];
  missingSkills: string[];
  insight: MatchInsight;
  generatedAt: string;
}

export interface CompareInsightCandidate {
  candidateId: string;
  fullName: string;
  /** Null when this candidate could not be assessed — see `error`. */
  score: number | null;
  band: string | null;
  eligibility: MatchEligibility | null;
  evidenceConfidence: number | null;
  /** MUST_HAVE rows that are not STRONG/MATCH, counted by the backend. */
  mustHaveGapCount: number | null;
  dimensions: MatchDimension[];
  error: string | null;
}

/** A decided winner, pinned to the deterministic figure behind it. */
export interface CompareSuperlative {
  candidateId: string;
  fullName: string;
  value: number;
}

export interface CompareInsights {
  vacancy: { id: string; title: string; status: string };
  candidates: CompareInsightCandidate[];
  superlatives: {
    bestTechnicalMatch: CompareSuperlative | null;
    bestSeniorityFit: CompareSuperlative | null;
    fewestMustHaveGaps: CompareSuperlative | null;
    highestEvidenceConfidence: CompareSuperlative | null;
  };
  generatedAt: string;
}
