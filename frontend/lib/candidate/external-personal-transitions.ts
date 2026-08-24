import type {
  ExternalApplicationStatus,
  ExternalJobPersonalState,
  ExternalJobTracking,
} from "@/lib/types";

/**
 * Every rule about how "saved" and "tracked" change — as pure functions.
 *
 * The hook that uses these owns the React parts: in-flight guards, re-renders,
 * which component asked. What it must NOT own is the product rules, because
 * those are the ones that would quietly break: that saving never touches a
 * tracker, that a failed request restores exactly what was there, and that the
 * server's answer beats the one the UI hoped for.
 *
 * Pulling them out here is what makes those rules testable without a browser,
 * and what stops them being re-decided differently in the next component that
 * needs them.
 */

/** What a save/unsave settles on once the backend has answered. */
export function applySaveResult(
  before: ExternalJobPersonalState,
  result: { ok: true; saved: boolean } | { ok: false },
): ExternalJobPersonalState {
  if (!result.ok) {
    // Exactly what was there. Not "false", not "the opposite of what we
    // tried" — a failed request changed nothing, so the reader must see
    // nothing changed.
    return before;
  }
  // The SERVER's boolean, even when it disagrees with what was requested.
  // Tracking is carried across untouched: saving a job is not applying to it,
  // and unsaving one is not withdrawing.
  return { saved: result.saved, tracking: before.tracking };
}

/** What marking-as-applied settles on. */
export function applyTrackingResult(
  before: ExternalJobPersonalState,
  result: { ok: true; tracking: ExternalJobTracking | null } | { ok: false },
): ExternalJobPersonalState {
  if (!result.ok || !result.tracking) {
    // No optimistic write was made, so there is nothing to undo — and a
    // record with no server id could not be edited afterwards anyway.
    return before;
  }
  // `saved` is carried across: marking an application never files a job into
  // the saved list, and never removes it from one.
  return { saved: before.saved, tracking: result.tracking };
}

/** What removing a tracker settles on. */
export function applyRemoveTrackingResult(
  before: ExternalJobPersonalState,
  result: { ok: true } | { ok: false },
): ExternalJobPersonalState {
  if (!result.ok) return before;
  // Only the tracker. A candidate tidying their tracking list has not unsaved
  // the job — and this product could not withdraw their application anyway.
  return { saved: before.saved, tracking: null };
}

/**
 * Whether a status change is worth a request.
 *
 * Only two reasons to refuse: there is nothing to edit, or the value is
 * already what the reader picked. Notably NOT refused: any transition between
 * two different statuses. External processes restart, skip stages and end
 * months later, and a product that rejected "Rejected → Interview" would be
 * telling somebody their own history is impossible.
 */
export function shouldSubmitStatusChange(
  state: ExternalJobPersonalState,
  next: ExternalApplicationStatus,
): boolean {
  if (!state.tracking) return false;
  return state.tracking.status !== next;
}

/**
 * The optimistic value for a save toggle.
 *
 * Optimistic ONLY because the rollback is exact: one boolean, and the previous
 * value is held. Nothing else in this feature is optimistic — creating a
 * tracking record mints a server id that cannot be invented, and showing
 * "Applied" before the write landed would let somebody close the tab believing
 * their application was recorded when it was not.
 */
export function optimisticSave(
  before: ExternalJobPersonalState,
): ExternalJobPersonalState {
  return { saved: !before.saved, tracking: before.tracking };
}
