import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_STALENESS_MS,
  REVALIDATE_BATCH_SIZE,
  REVALIDATE_MAX_BATCHES,
} from './external-jobs.constants';

export interface RevalidateOutcome {
  /** ACTIVE jobs whose last observation is beyond the staleness window. */
  staled: number;
  /** Jobs hard-deleted because their employer-stated deadline has passed. */
  expired: number;
  /** Legacy non-current rows (CLOSED/EXPIRED/UNAVAILABLE) hard-deleted. */
  purged: number;
  /** Every job id this run hard-deleted — Qdrant reconciliation follows. */
  removedJobIds: string[];
  /** Batches executed across the passes (bounded). */
  batches: number;
  /** True when a pass hit its batch ceiling — the next run continues. */
  truncated: boolean;
}

/**
 * The DB-local half of the external-job lifecycle: ageing.
 *
 * ## What this is — and is deliberately not
 *
 * Provider sweeps observe; this pass only lets time act on what was already
 * observed. It makes NO provider HTTP calls (its only dependency is Prisma),
 * and it can therefore never confuse an outage with a disappearance — the one
 * failure mode the lifecycle design exists to prevent. The transitions are
 * exactly the time-driven subset of `resolveJobStatus`, restated as bounded
 * indexed UPDATEs:
 *
 *   ACTIVE, last observed > staleness window ago      → STALE  (still shown)
 *   ACTIVE|STALE, employer deadline `expiresAt` past  → EXPIRED (hidden)
 *
 * And the transitions it REFUSES to make, as a matter of design:
 *
 *   → CLOSED       requires a source that positively said so (ingestion)
 *   → UNAVAILABLE  requires every source individually retired (ingestion)
 *   → ACTIVE       requires a fresh observation (ingestion re-listing)
 *
 * Age alone never closes a job: an old posting is an old posting, and STALE
 * remains candidate-searchable on purpose. A provider removed from the
 * configuration stops producing observations, so its jobs drift ACTIVE →
 * STALE here — visible with an honest "last seen" — instead of staying
 * fresh-looking forever or being guessed into CLOSED.
 *
 * ## The threshold is the existing one
 *
 * `DEFAULT_STALENESS_MS` (14 days) — the same constant ingestion's own
 * `resolveJobStatus` call uses. No second window exists to drift from the
 * first. The comparison column is the job's `lastSeenAt` (the freshest
 * observation any source made), which can only be LATER than the
 * per-active-source freshness the ingestion rule reads — so this pass can
 * mark STALE later than ingestion would, never earlier. `lastVerifiedAt` is
 * deliberately not used: sweeps touch it on every pass over unchanged rows,
 * so it measures our own activity, not the posting's.
 *
 * ## Scale and concurrency
 *
 * Both passes work in `LIMIT`-bounded batches selected `FOR UPDATE SKIP
 * LOCKED` through the existing `(status, lastSeenAt)` index and the additive
 * `(status, expiresAt)` index — no unbounded scan, no row list in Node
 * memory, ever. SKIP LOCKED makes two concurrent runs (two replicas, or a
 * retry racing a live run) partition the work instead of blocking or
 * double-writing; the WHERE clauses re-check status inside the UPDATE, so a
 * row another actor already transitioned simply stops matching. Every
 * transition is monotone and re-derivable, so a crash mid-run loses nothing
 * but time. `searchableUpdatedAt` is bumped because a status change is a
 * search-visible fact; the existing index reconciliation picks it up from
 * there.
 */
@Injectable()
export class ExternalRevalidateService {
  private readonly logger = new Logger(ExternalRevalidateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async revalidate(
    input: { jobIds?: string[] } = {},
  ): Promise<RevalidateOutcome> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - DEFAULT_STALENESS_MS);
    const restriction = restrictionFragment(input.jobIds);

    let batches = 0;
    let expired = 0;
    let purged = 0;
    let staled = 0;
    let truncated = false;
    const removedJobIds: string[] = [];

    /*
     * EXPIRED first — and under the live-only lifecycle it is a HARD DELETE,
     * not a status change: a deadline the employer themselves published is
     * authoritative closure, and closed external jobs are not history this
     * product keeps. DB-local, no provider call involved, so a provider
     * outage can never influence this pass; FK CASCADE removes the job's
     * sources, saved rows and application trackers atomically with the row.
     */
    while (batches < REVALIDATE_MAX_BATCHES) {
      batches += 1;
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        DELETE FROM external_jobs
        WHERE id IN (
          SELECT id FROM external_jobs
          WHERE status IN ('ACTIVE', 'STALE')
            AND "expiresAt" IS NOT NULL
            AND "expiresAt" <= ${now}
            ${restriction}
          LIMIT ${REVALIDATE_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      `;
      expired += rows.length;
      removedJobIds.push(...rows.map((row) => row.id));
      if (rows.length < REVALIDATE_BATCH_SIZE) break;
    }

    /*
     * Legacy purge: rows that already carry a non-current status
     * (CLOSED / EXPIRED / UNAVAILABLE) predate the live-only lifecycle —
     * each status was itself assigned by an authoritative signal (a source
     * that said closed, a passed deadline, or a successful complete
     * enumeration that stopped listing it), so their absence from the live
     * universe is already proven. Steady-state this pass deletes nothing;
     * it exists so the catalogue self-heals to zero retained history.
     * STALE is NOT purged — it is a current, searchable status.
     */
    while (batches < REVALIDATE_MAX_BATCHES) {
      batches += 1;
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        DELETE FROM external_jobs
        WHERE id IN (
          SELECT id FROM external_jobs
          WHERE status IN ('CLOSED', 'EXPIRED', 'UNAVAILABLE')
            ${restriction}
          LIMIT ${REVALIDATE_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      `;
      purged += rows.length;
      removedJobIds.push(...rows.map((row) => row.id));
      if (rows.length < REVALIDATE_BATCH_SIZE) break;
    }

    while (batches < REVALIDATE_MAX_BATCHES) {
      batches += 1;
      const changed = await this.prisma.$executeRaw`
        UPDATE external_jobs
        SET status = 'STALE',
            "searchableUpdatedAt" = ${now}
        WHERE id IN (
          SELECT id FROM external_jobs
          WHERE status = 'ACTIVE'
            AND "lastSeenAt" < ${staleBefore}
            ${restriction}
          LIMIT ${REVALIDATE_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
          AND status = 'ACTIVE'
      `;
      staled += changed;
      if (changed < REVALIDATE_BATCH_SIZE) break;
    }
    // Budget exhausted with work possibly remaining: the transitions are
    // monotone, so the next hourly run simply continues where this stopped.
    if (batches >= REVALIDATE_MAX_BATCHES) truncated = true;

    if (expired > 0 || purged > 0 || staled > 0 || truncated) {
      this.logger.log(
        `External lifecycle revalidation: ${expired} expired-deleted, ` +
          `${purged} legacy purged, ${staled} staled, ${batches} batch(es)` +
          (truncated ? '; ceiling reached, next run continues' : ''),
      );
    }
    return { staled, expired, purged, removedJobIds, batches, truncated };
  }
}

/**
 * Optional id restriction for targeted revalidation. Empty/absent means the
 * whole catalogue (in bounded batches) — the scheduled hourly case.
 */
function restrictionFragment(jobIds?: string[]): Prisma.Sql {
  if (!jobIds || jobIds.length === 0) return Prisma.empty;
  return Prisma.sql`AND id IN (${Prisma.join(jobIds)})`;
}
