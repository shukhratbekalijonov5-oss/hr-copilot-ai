/**
 * Evidence confidence: how much CURRENT, INDEPENDENT, CONSISTENT material the
 * analysis stands on. 0–100.
 *
 * NOT a probability, NOT a hiring likelihood, and independent of the match
 * score by design: Match 82 / Confidence 51 legitimately means "reads strong,
 * but on thin evidence". A sparse candidate must never appear as certain as a
 * well-documented one.
 *
 * Five components (see EvidenceConfidenceBreakdown):
 *   sources     0..30  distinct current sources (files + links)
 *   volume      0..20  indexed evidence characters
 *   coverage    0..25  this vacancy's requirement rows with evidence
 *   profile     0..15  headline/summary/skills/experience/education present
 *   consistency 0..10  10 minus contradiction penalties
 *
 * Freshness needs no separate term: Rule N1 guarantees everything scored here
 * IS the current state — stale evidence is unreachable, not down-weighted.
 */

import type {
  EvidenceConfidenceBreakdown,
  MatchContradiction,
  RequirementMatrixRow,
} from './advanced-match.types';
import type { ProfileFacts } from './profile-facts';

export interface ConfidenceInputs {
  /** Distinct current evidence sources for the candidate (files + links). */
  evidenceSourceCount: number;
  /** Total indexed evidence characters across those sources. */
  evidenceChars: number;
  matrix: readonly RequirementMatrixRow[];
  profile: ProfileFacts;
  contradictions: readonly MatchContradiction[];
}

export interface ConfidenceResult {
  evidenceConfidence: number;
  breakdown: EvidenceConfidenceBreakdown;
}

/**
 * Distinct INDEPENDENT sources from the ai-service capability summary's
 * `evidenceSources` map. The pseudo-source `"Profile"` (the profile form
 * itself) is excluded: confidence measures independent corroboration, and
 * the profile is a self-statement, not a source. Without this, every
 * one-file candidate read as two sources.
 */
export function countIndependentEvidenceSources(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  return Object.keys(value as Record<string, unknown>).filter(
    (key) => key !== 'Profile',
  ).length;
}

export function computeEvidenceConfidence(
  input: ConfidenceInputs,
): ConfidenceResult {
  const n = input.evidenceSourceCount;
  const sources = n >= 3 ? 30 : n === 2 ? 24 : n === 1 ? 15 : 0;

  const chars = input.evidenceChars;
  const volume =
    chars >= 8000
      ? 20
      : chars >= 3000
        ? 16
        : chars >= 1000
          ? 12
          : chars > 0
            ? 6
            : 0;

  let coverage: number;
  if (input.matrix.length === 0) {
    coverage = 12; // nothing stated to cover — neutral, not zero
  } else {
    const credit = input.matrix.reduce((sum, row) => {
      if (row.status === 'STRONG' || row.status === 'MATCH') return sum + 1;
      if (row.status === 'PARTIAL') return sum + 0.5;
      return sum;
    }, 0);
    coverage = Math.round((credit / input.matrix.length) * 25);
  }

  const p = input.profile;
  const profileCompleteness =
    (p.headline ? 3 : 0) +
    (p.summary ? 3 : 0) +
    (p.skills.length >= 3 ? 3 : 0) +
    (p.experience.length >= 1 ? 3 : 0) +
    (p.educationCount >= 1 ? 3 : 0);

  const penalties = input.contradictions.reduce(
    (sum, c) => sum + c.confidencePenalty,
    0,
  );
  const consistency = Math.max(0, 10 - penalties);

  const breakdown: EvidenceConfidenceBreakdown = {
    sources,
    volume,
    coverage,
    profileCompleteness,
    consistency,
  };
  return {
    evidenceConfidence:
      sources + volume + coverage + profileCompleteness + consistency,
    breakdown,
  };
}
