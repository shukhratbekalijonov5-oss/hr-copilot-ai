import type { IntentAlignment, IntentDimension } from './intent-alignment';

/**
 * The ONE versioned scoring policy for candidate↔job ranking.
 *
 * Every number that turns alignments into an order lives in this file, so
 * "what does the algorithm do" has exactly one answer, and every change to it
 * is a version bump. The version is part of every stored run: bump it and all
 * existing snapshots invalidate on their next read, even though no data
 * changed — which is the point, because the same data would now rank
 * differently.
 *
 * v1 (implicit): capability only — the five evidence signals computed in the
 *     ai-service, score = capability, order = (score desc, vacancyId asc).
 * v2: capability + intent. Hard exclusions carve the universe first;
 *     capability is unchanged; stated preferences add a bounded intent term.
 * v3: cross-currency salary. Same 80/20 split and the same dimension weights
 *     — what changed is that salary now compares across currencies through
 *     the FX snapshot and understands a desired RANGE, so the same data can
 *     legitimately produce a different salary verdict than v2 did. That is an
 *     algorithm change even though no weight moved, so the version bumps and
 *     every v2 snapshot recomputes.
 */
export const MATCH_ALGORITHM_VERSION = 'v3';

/**
 * How much of the canonical score capability keeps when intent exists at all.
 *
 * CAPABILITY MUST DOMINATE. The failure mode this ratio prevents: a candidate
 * with thin evidence and a perfectly-tuned preference profile outranking
 * demonstrated ability. At 80/20, a 90-capability job with a fully mismatched
 * intent still scores 72 and beats a 30-capability job with perfect intent
 * (44). Preferences reorder the neighborhood; evidence decides the league.
 */
export const CAPABILITY_SHARE = 0.8;
export const INTENT_SHARE = 1 - CAPABILITY_SHARE;

/**
 * Relative weight of each dimension INSIDE the intent score.
 *
 * The six first-class dimensions carry 96 of 100; industries and benefits are
 * secondary color. Role and location lead because they are what people mean
 * when they say what job they want; work mode and salary shape daily life;
 * employment type and seniority narrow rather than define. The weights only
 * matter relative to each other — the set that actually applies to one
 * vacancy is renormalized over the dimensions that were stated AND comparable
 * (UNKNOWN/NOT_COMPARABLE alignments drop out entirely, so an employer's
 * silence on salary neither costs nor buys rank).
 */
export const INTENT_DIMENSION_WEIGHTS: Record<IntentDimension, number> = {
  role: 30,
  location: 24,
  workMode: 14,
  salary: 12,
  employmentType: 8,
  seniority: 8,
  industries: 2,
  benefits: 2,
};

/**
 * 0–100 intent score, or null when there is nothing to score.
 *
 * Null and 0 mean OPPOSITE things: null is "the candidate stated nothing (or
 * nothing stated was comparable to this job)" and leaves the canonical score
 * purely capability; 0 is "everything they asked for, this job contradicts".
 * Collapsing the two would make silence look like rejection.
 */
export function intentScoreFrom(alignments: IntentAlignment[]): number | null {
  let weightTotal = 0;
  let weighted = 0;
  for (const alignment of alignments) {
    if (alignment.score === null) continue;
    const weight = INTENT_DIMENSION_WEIGHTS[alignment.dimension];
    weightTotal += weight;
    weighted += weight * alignment.score;
  }
  if (weightTotal === 0) return null;
  return Math.round((weighted / weightTotal) * 100);
}

/**
 * The canonical 0–100 score. It decides ORDER and only order — existence was
 * decided by hard constraints before any score existed, and no floor,
 * threshold or band anywhere may turn this number back into a filter. A
 * candidate with no intent signal gets EXACTLY the capability score, which is
 * what makes "no preferences" a provable no-op against the pre-intent
 * baseline.
 */
export function canonicalScore(
  capabilityScore: number,
  intentScore: number | null,
): number {
  if (intentScore === null) return capabilityScore;
  return Math.round(
    CAPABILITY_SHARE * capabilityScore + INTENT_SHARE * intentScore,
  );
}

export interface RankableEntry {
  vacancyId: string;
  canonicalScore: number;
  capabilityScore: number;
  intentScore: number | null;
}

/**
 * Deterministic total order: canonical desc, capability desc, intent desc
 * (null after any number — no signal sorts below a known-zero signal only
 * here, where all that is left to decide is a stable order), vacancyId asc.
 * Never database return order: pagination slices this list, and two entries
 * must compare the same way on every page of every request.
 */
export function compareRanked(a: RankableEntry, b: RankableEntry): number {
  if (a.canonicalScore !== b.canonicalScore) {
    return b.canonicalScore - a.canonicalScore;
  }
  if (a.capabilityScore !== b.capabilityScore) {
    return b.capabilityScore - a.capabilityScore;
  }
  const aIntent = a.intentScore ?? -1;
  const bIntent = b.intentScore ?? -1;
  if (aIntent !== bIntent) return bIntent - aIntent;
  return a.vacancyId < b.vacancyId ? -1 : a.vacancyId > b.vacancyId ? 1 : 0;
}

/**
 * The label shown beside the score.
 *
 * Presentation metadata, and ONLY that: no band filters, hides or removes
 * anything, and LOW is returned and rendered like any other. Centralized here
 * so the thresholds exist once rather than drifting between the API, the card
 * and any future surface.
 *
 * ## The thresholds
 *
 * Chosen against the real distribution rather than round numbers: across the
 * live catalogue the canonical score piles up between 30 and 50, with a thin
 * tail above 70. Cutting at 85 (a common default) would have made STRONG
 * almost unreachable and labelled most genuinely reasonable matches LOW, which
 * would be a lie told in a nicer word.
 *
 * ## Why capability can cap the band
 *
 * The ai-service already refuses to call a job better than WEAK when the
 * evidence demonstrates none of its stated requirements — a job can read as
 * similar to a candidate's background and still not show one thing it asks
 * for. A band derived from the score alone would quietly undo that, so a WEAK
 * capability verdict caps the band at PARTIAL. The number and the words then
 * cannot tell different stories.
 */
export type MatchBand = 'STRONG' | 'GOOD' | 'PARTIAL' | 'LOW';

export const MATCH_BAND_THRESHOLDS = {
  STRONG: 80,
  GOOD: 60,
  PARTIAL: 35,
} as const;

export function matchBand(
  canonical: number,
  capabilityTier?: string | null,
): MatchBand {
  const raw: MatchBand =
    canonical >= MATCH_BAND_THRESHOLDS.STRONG
      ? 'STRONG'
      : canonical >= MATCH_BAND_THRESHOLDS.GOOD
        ? 'GOOD'
        : canonical >= MATCH_BAND_THRESHOLDS.PARTIAL
          ? 'PARTIAL'
          : 'LOW';
  if (capabilityTier === 'WEAK' && (raw === 'STRONG' || raw === 'GOOD')) {
    return 'PARTIAL';
  }
  return raw;
}
