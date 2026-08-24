/**
 * Only the newest answer is allowed to win.
 *
 * ## The failure this exists to prevent
 *
 * A reader opens job A, then half a second later opens job B. Two reads are in
 * flight. A's server happens to be slower, so the responses arrive B then A —
 * and the panel, which just writes whatever arrives, ends up showing job A's
 * description under job B's title. Nothing errored, nothing logged, and the
 * reader has no way to know they are looking at the wrong job.
 *
 * ## Why identity rather than AbortController
 *
 * `AbortController` stops a request; it does not decide which answer is
 * current, and a request already past the network is not stopped by anything.
 * Identity answers the actual question — "is this still what the reader is
 * waiting for?" — and answers it the same way whether the work was a fetch, a
 * Server Action (which cannot be aborted from the browser at all) or a cache
 * hit that resolved before the abort was even wired up.
 *
 * Aborting is a worthwhile addition on top for saving bandwidth; it is not a
 * substitute, and treating it as one is how the bug above survives a fix.
 *
 * ## Why a closure rather than a comparable token
 *
 * `begin()` hands back a predicate rather than a number. A caller cannot
 * compare the wrong token, forget to compare, or compare against a token it
 * captured from a different request — the only thing it can do with the value
 * is ask whether its own request is still the current one.
 */

export interface LatestRequestGate {
  /** Claims the gate for a new request; the result reports if it still holds. */
  begin: () => () => boolean;
  /** Discards whatever is in flight, e.g. when a panel closes. */
  cancel: () => void;
}

export function createLatestRequestGate(): LatestRequestGate {
  let current = 0;
  return {
    begin() {
      const token = ++current;
      return () => token === current;
    },
    cancel() {
      // Nothing outstanding can match again. Deliberately not a reset to 0:
      // a token issued before a cancel must never become current a second
      // time, which is what a counter that only moves forward guarantees.
      current += 1;
    },
  };
}

export type LatestRequestOutcome<T> =
  /** A newer request superseded this one. Its result must be discarded. */
  | { stale: true }
  | { stale: false; ok: true; value: T }
  | { stale: false; ok: false; error: unknown };

/**
 * Runs `work` and reports whether its answer is still the current one.
 *
 * A rejection from a superseded request is reported as `stale` rather than as
 * a failure: a request nobody is waiting for cannot fail in a way a reader
 * should be told about, and surfacing it would flash an error over results
 * that are perfectly fine.
 */
export async function runLatest<T>(
  gate: LatestRequestGate,
  work: () => Promise<T>,
): Promise<LatestRequestOutcome<T>> {
  const isCurrent = gate.begin();
  try {
    const value = await work();
    return isCurrent() ? { stale: false, ok: true, value } : { stale: true };
  } catch (error) {
    return isCurrent() ? { stale: false, ok: false, error } : { stale: true };
  }
}
