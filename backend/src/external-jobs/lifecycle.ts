import type {
  ExternalJobStatus,
  ExternalSourceStatus,
} from '../generated/prisma/enums';

/**
 * When an external job stops being something to show a candidate.
 *
 * ## The rule that matters most
 *
 * A provider failing is not a job closing. If Greenhouse times out for an hour,
 * nothing was learned about the ten thousand jobs it serves — and a system that
 * treats "I could not fetch" as "it is gone" empties the catalogue during an
 * outage and refills it afterwards, having shown every candidate an empty
 * result page in between.
 *
 * So closure requires POSITIVE evidence:
 *
 *   the source said it is closed                        → CLOSED
 *   the source returned 404/410 for it specifically     → that source is GONE
 *   a SUCCESSFUL full listing no longer contains it,
 *     from a provider whose listings are complete       → that source is GONE
 *   the posting's own stated deadline has passed        → EXPIRED
 *   nobody has seen it for a while                      → STALE (still shown)
 *
 * "The fetch failed" appears nowhere in that list.
 *
 * ## STALE is visible on purpose
 *
 * A job nobody has re-observed recently is probably still open — job boards
 * are not obliged to be re-listed on our schedule. Hiding it would be choosing
 * a false negative (a real job the candidate never sees) over a false positive
 * (a possibly-filled job they can check in one click). The status travels with
 * the job so the UI can say "last seen 9 days ago" rather than pretending
 * freshness it does not have.
 */

export interface SourceObservation {
  status: ExternalSourceStatus;
  lastSeenAt: Date;
}

export interface LifecycleInput {
  sources: SourceObservation[];
  expiresAt: Date | null;
  /** Longest staleness window among the providers that carry this job. */
  stalenessMs: number;
  now: Date;
}

/**
 * The canonical status implied by every source's current state.
 *
 * Order is deliberate. A job with ANY live source is ACTIVE regardless of what
 * the others say: one aggregator dropping a posting proves nothing while the
 * company's own page still lists it.
 */
export function resolveJobStatus(input: LifecycleInput): ExternalJobStatus {
  const { sources, expiresAt, stalenessMs, now } = input;

  if (sources.length === 0) return 'UNAVAILABLE';

  const active = sources.filter((source) => source.status === 'ACTIVE');

  // A deadline the employer themselves published is the one closure signal
  // that needs no source at all.
  if (expiresAt && expiresAt <= now) return 'EXPIRED';

  if (active.length === 0) {
    // Every source is closed or gone. Prefer the stronger claim: a source that
    // SAID "closed" is evidence about the job; one that merely vanished is
    // evidence about the source.
    const anyClosed = sources.some((source) => source.status === 'CLOSED');
    return anyClosed ? 'CLOSED' : 'UNAVAILABLE';
  }

  const freshest = active.reduce(
    (latest, source) =>
      source.lastSeenAt > latest ? source.lastSeenAt : latest,
    active[0].lastSeenAt,
  );
  if (now.getTime() - freshest.getTime() > stalenessMs) return 'STALE';

  return 'ACTIVE';
}

/**
 * What a completed sweep implies for a source that was NOT in it.
 *
 * Two conditions, both required:
 *
 *   - the run actually SUCCEEDED. A failed or partial run saw an unknown
 *     fraction of the catalogue and cannot be read as an absence.
 *   - the provider's listings are complete. Some sources paginate unstably or
 *     return a rolling window, where a job's absence from one sweep is normal.
 *
 * When either is false the source is left exactly as it was. It will go STALE
 * on its own if it truly stopped appearing, which is the honest outcome: we
 * stopped seeing it, and we do not know why.
 */
export function absenceVerdict(input: {
  runSucceeded: boolean;
  absenceImpliesClosed: boolean;
}): ExternalSourceStatus | null {
  if (!input.runSucceeded) return null;
  if (!input.absenceImpliesClosed) return null;
  return 'GONE';
}

/**
 * Whether a job may be shown to a candidate right now.
 *
 * The candidate-facing universe is ACTIVE and STALE. CLOSED, EXPIRED and
 * UNAVAILABLE are excluded — not deleted, because their history is what lets a
 * later sweep notice the posting came back, and because "this job existed" is
 * a fact worth keeping.
 */
export const CURRENT_EXTERNAL_STATUSES: readonly ExternalJobStatus[] = [
  'ACTIVE',
  'STALE',
];

export function isCurrentlySearchable(status: ExternalJobStatus): boolean {
  return CURRENT_EXTERNAL_STATUSES.includes(status);
}
