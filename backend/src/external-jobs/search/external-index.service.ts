import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiServiceClient } from '../../ai/ai-service.client';
import { CURRENT_EXTERNAL_STATUSES } from '../lifecycle';

/**
 * Keeping the semantic index roughly in step with the catalogue.
 *
 * ## "Roughly" is the design, not a compromise
 *
 * This index accelerates retrieval; it never decides what exists. A job it has
 * not reached yet is still fully findable through the lexical index, and a job
 * it still holds after that job closed is dropped by the PostgreSQL
 * revalidation every search performs. Both failure modes cost recall for a few
 * minutes and cost correctness never — which is exactly why indexing is
 * allowed to be asynchronous, batched, retryable and occasionally behind.
 *
 * That property is load-bearing for ingestion too. A provider sweep must
 * succeed when the embedding model is down: jobs land in Postgres, they are
 * searchable through the lexical path immediately, and they acquire vectors
 * whenever the index catches up. Blocking a sweep on an embedding call would
 * mean an unrelated outage stops the catalogue from updating.
 */

/** Jobs embedded per call. Bounded so one pass cannot run for minutes. */
const INDEX_BATCH = 200;
/** Jobs removed from the index per call. */
const DELETE_BATCH = 500;

export interface ExternalIndexOutcome {
  indexed: number;
  removed: number;
  /** Jobs still waiting. Non-zero means run again — this is index lag. */
  pending: number;
  skipped: boolean;
}

@Injectable()
export class ExternalIndexService {
  private readonly logger = new Logger(ExternalIndexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
  ) {}

  /**
   * One reconciliation pass for a completed run: drop the points of jobs the
   * run HARD-DELETED from PostgreSQL, then run the ordinary bounded catch-up.
   *
   * Qdrant strictly follows committed PostgreSQL deletions — the ids arrive
   * here only after the delete transaction committed, so a failed/partial
   * provider fetch (which deletes nothing) can never erase points. A Qdrant
   * hiccup THROWS: the BullMQ job retries with backoff, and deleting an
   * already-absent point is a no-op, so retries are idempotent.
   */
  async reconcile(
    input: { removedIds?: string[] } = {},
  ): Promise<ExternalIndexOutcome & { pointsDeleted: number }> {
    const removedIds = [...new Set(input.removedIds ?? [])];
    let pointsDeleted = 0;
    if (this.ai.enabled && removedIds.length > 0) {
      for (let i = 0; i < removedIds.length; i += DELETE_BATCH) {
        const chunk = removedIds.slice(i, i + DELETE_BATCH);
        await this.ai.deleteExternalJobIndex(chunk);
        pointsDeleted += chunk.length;
      }
      this.logger.log(
        `Semantic index: ${pointsDeleted} point(s) removed for hard-deleted jobs`,
      );
    }
    const pass = await this.indexPending();
    return { ...pass, pointsDeleted };
  }

  /**
   * One bounded pass: index what changed, forget what left.
   *
   * Selection is `searchIndexedAt IS NULL OR searchIndexedAt < searchableUpdatedAt`
   * — the same "search-relevant edit" clock the universe revision uses, so a
   * provider sweep that merely re-observed a posting does not cause the whole
   * catalogue to be re-embedded every six hours.
   */
  async indexPending(limit = INDEX_BATCH): Promise<ExternalIndexOutcome> {
    if (!this.ai.enabled) {
      // Not an error. A deployment with no AI service runs lexical-only
      // search, which is a complete product, just a narrower one.
      return { indexed: 0, removed: 0, pending: 0, skipped: true };
    }

    const removed = await this.removeDeparted();

    const stale = await this.prisma.$queryRaw<
      {
        id: string;
        status: string;
        title: string;
        description: string | null;
        countryCode: string | null;
        region: string | null;
        city: string | null;
        workMode: string | null;
        employmentType: string | null;
        seniorityLevel: string | null;
        companyName: string;
      }[]
    >`
      SELECT j.id, j.status::text AS "status", j.title, j.description,
             j."countryCode", j.region, j.city,
             j."workMode"::text AS "workMode",
             j."employmentType"::text AS "employmentType",
             j."seniorityLevel"::text AS "seniorityLevel",
             c.name AS "companyName"
      FROM external_jobs j
      JOIN external_companies c ON c.id = j."externalCompanyId"
      WHERE j.status = ANY(${CURRENT_EXTERNAL_STATUSES}::"ExternalJobStatus"[])
        AND (j."searchIndexedAt" IS NULL
             OR j."searchIndexedAt" < j."searchableUpdatedAt")
      ORDER BY j."searchableUpdatedAt" ASC
      LIMIT ${limit}
    `;

    if (stale.length === 0) {
      return { indexed: 0, removed, pending: 0, skipped: false };
    }

    /*
     * Clipped to the AI service's declared field limits BEFORE the call.
     * Providers publish arbitrarily long postings (a 20k+ description is
     * real), and one over-limit row would 422 the whole batch — found live
     * when the first automatic reconciliation met a 21k Lever description.
     * Loss-free in practice: the index text builder embeds only the first
     * ~1200 characters anyway.
     */
    const clip = (value: string | null | undefined, max: number) =>
      value == null ? null : value.slice(0, max);
    const indexed = await this.ai.indexExternalJobs(
      stale.map((row) => ({
        externalJobId: row.id,
        status: row.status,
        title: clip(row.title, 300) as string,
        companyName: clip(row.companyName, 300),
        description: clip(row.description, 20_000),
        countryCode: clip(row.countryCode, 2),
        region: clip(row.region, 200),
        city: clip(row.city, 200),
        workMode: clip(row.workMode, 20),
        employmentType: clip(row.employmentType, 30),
        seniorityLevel: clip(row.seniorityLevel, 30),
      })),
    );

    /*
     * Stamped only AFTER the index call returned. A crash between the two
     * leaves the jobs looking un-indexed, so the next pass redoes them —
     * duplicate work, which is cheap and idempotent. Stamping first would
     * leave them looking indexed when they are not, which is silent data loss
     * from the searcher's point of view.
     */
    await this.prisma.externalJob.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { searchIndexedAt: new Date() },
    });

    const pending = await this.pendingCount();
    this.logger.log(
      `Semantic index: ${indexed} job(s) indexed, ${removed} removed, ` +
        `${pending} still pending`,
    );
    return { indexed, removed, pending, skipped: false };
  }

  /**
   * Drop points for jobs that have left the searchable universe.
   *
   * Housekeeping, not correctness: a closed job whose point survives is
   * already excluded by the revalidation step. Removing it stops the semantic
   * branch from spending its top-K on jobs that will be discarded, which is
   * the difference between retrieving 150 candidates and retrieving 150
   * USEFUL candidates.
   */
  private async removeDeparted(): Promise<number> {
    const departed = await this.prisma.externalJob.findMany({
      where: {
        status: { notIn: [...CURRENT_EXTERNAL_STATUSES] },
        searchIndexedAt: { not: null },
      },
      select: { id: true },
      take: DELETE_BATCH,
    });
    if (departed.length === 0) return 0;

    const ids = departed.map((row) => row.id);
    await this.ai.deleteExternalJobIndex(ids);
    // Cleared so a job that comes back — a re-listed posting is a real thing —
    // is picked up as needing indexing again.
    await this.prisma.externalJob.updateMany({
      where: { id: { in: ids } },
      data: { searchIndexedAt: null },
    });
    return ids.length;
  }

  /** How many current jobs are waiting for a vector. Reported as index lag. */
  async pendingCount(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM external_jobs j
      WHERE j.status = ANY(${CURRENT_EXTERNAL_STATUSES}::"ExternalJobStatus"[])
        AND (j."searchIndexedAt" IS NULL
             OR j."searchIndexedAt" < j."searchableUpdatedAt")
    `;
    return Number(rows[0]?.count ?? 0);
  }
}
