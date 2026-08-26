/**
 * Score change: what happened to THIS candidate/vacancy pair between the
 * previous ranking run and the current one, with requirement-level reasons.
 *
 * ## Where the previous score is persisted (the authoritative answer)
 *
 * When a ranking run is REPLACED, the persist transaction first reads the
 * outgoing run's entries and hands each new entry the outgoing canonical
 * score plus the outgoing requirement statuses. Those travel INSIDE the new
 * entry's stored insight as `scoreChange` — nothing else survives: no
 * evidence text, no citations, no retrievable stale content (Rule N1: the
 * previous score is comparison METADATA, and it never participates in
 * current scoring or retrieval).
 *
 * A run deleted with no successor (account deletion) carries nothing forward.
 * A recompute with identical inputs (refresh) legitimately produces delta 0.
 */

import type {
  MatchScoreChange,
  RequirementMatrixRow,
} from './advanced-match.types';

/** Compact previous-state snapshot carried across a run replacement. */
export interface PreviousEntryMeta {
  score: number;
  /** text → matrix status, extracted from the outgoing entry's insight. */
  requirementStatuses: Record<string, string>;
}

const EVIDENCED = new Set(['STRONG', 'MATCH']);
const MAX_REASONS = 5;

export function buildScoreChange(
  previous: PreviousEntryMeta | null,
  currentScore: number,
  matrix: readonly RequirementMatrixRow[],
): MatchScoreChange | null {
  if (!previous) return null;

  const reasons: string[] = [];
  for (const row of matrix) {
    if (reasons.length >= MAX_REASONS) break;
    const before = previous.requirementStatuses[row.text];
    if (!before) continue;
    const wasEvidenced = EVIDENCED.has(before);
    const isEvidenced = EVIDENCED.has(row.status);
    if (!wasEvidenced && isEvidenced) {
      reasons.push(`+ now evidenced: ${row.text}`);
    } else if (wasEvidenced && !isEvidenced) {
      reasons.push(`− no longer evidenced: ${row.text}`);
    } else if (
      row.priority === 'MUST_HAVE' &&
      row.status === 'MISSING' &&
      before === 'MISSING'
    ) {
      reasons.push(`− still missing: ${row.text}`);
    }
  }

  return {
    previous: previous.score,
    current: currentScore,
    delta: currentScore - previous.score,
    reasons,
  };
}

/** The statuses map an entry contributes when its run is replaced. */
export function requirementStatusesOf(
  matrix: readonly RequirementMatrixRow[] | undefined | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of matrix ?? []) map[row.text] = row.status;
  return map;
}
