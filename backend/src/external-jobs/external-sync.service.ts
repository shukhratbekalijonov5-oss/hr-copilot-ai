import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExternalIngestionService } from './external-ingestion.service';
import { ExternalProviderRegistry } from './provider-registry';
import { sourceKeyOf } from './dedupe';
import { EXTERNAL_SYNC_MAX_PAGES } from './external-jobs.constants';
import type { ExternalJobProvider } from './external-job.provider';
import type {
  ExternalIngestionStatus,
  ExternalProvider,
} from '../generated/prisma/enums';

export interface SyncOutcome {
  runId: string;
  provider: ExternalProvider;
  scopes: string[];
  status: ExternalIngestionStatus;
  fetched: number;
  created: number;
  updated: number;
  merged: number;
  unmerged: number;
  closed: number;
  failed: number;
  durationMs: number;
}

/**
 * One provider sweep, start to finish.
 *
 * ## The shape of a run
 *
 *   open a run row -> walk the provider's pages -> ingest each page ->
 *   retire what a COMPLETE listing no longer contains -> close the run
 *
 * ## Why failure is graded so carefully
 *
 * The dangerous outcome is not a failed sync; it is a sync that half-worked
 * and was then treated as authoritative. If the first board succeeds and the
 * second times out, the run is PARTIAL — and the absence sweep still runs for
 * the first board, which was completely enumerated, and never for the second,
 * which was not. Completeness is tracked per scope for exactly this reason.
 *
 * A provider that fails on its first page produces a FAILED run that changes
 * nothing: no job closed, no job deleted, every posting already stored still
 * visible. An outage must cost freshness, never inventory.
 */
@Injectable()
export class ExternalSyncService {
  private readonly logger = new Logger(ExternalSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ExternalProviderRegistry,
    private readonly ingestion: ExternalIngestionService,
  ) {}

  async syncProvider(
    name: ExternalProvider,
    now: Date = new Date(),
  ): Promise<SyncOutcome | null> {
    const provider = this.registry.get(name);
    if (!provider) {
      this.logger.warn(`No registered provider named ${name}; nothing to sync`);
      return null;
    }

    const started = Date.now();
    const run = await this.prisma.externalIngestionRun.create({
      data: { provider: name, status: 'RUNNING', startedAt: now },
      select: { id: true },
    });

    const counters = {
      fetched: 0,
      created: 0,
      updated: 0,
      merged: 0,
      unmerged: 0,
      failed: 0,
      closed: 0,
    };
    /** Source keys seen, per scope. */
    const observed = new Map<string, Set<string>>();
    /** Scopes every page of which reported a complete listing. */
    const complete = new Set<string>();
    /** Scopes disqualified by any partial page. Sticky on purpose. */
    const partial = new Set<string>();
    let fetchFailure: string | null = null;

    try {
      let cursor: string | null = null;
      for (let page = 0; page < EXTERNAL_SYNC_MAX_PAGES; page += 1) {
        const result = await provider.fetchPage(cursor);
        const scope = result.scopeKey;

        counters.fetched += result.jobs.length + result.rejected.length;
        // A posting rejected at the provider boundary is still a failed
        // posting; counting it here keeps the run's numbers equal to what the
        // board actually contained.
        counters.failed += result.rejected.length;
        for (const rejection of result.rejected) {
          this.logger.warn(
            `Provider ${name} could not normalize ${scope}/` +
              `${rejection.sourceJobId ?? 'unknown'}: ${rejection.reason}`,
          );
        }

        const outcome = await this.ingestion.ingestBatch(
          result.jobs,
          scope || null,
          now,
        );
        counters.created += outcome.created;
        counters.updated += outcome.updated;
        counters.merged += outcome.merged;
        counters.unmerged += outcome.unmerged;
        counters.failed += outcome.failed;

        if (scope) {
          const keys = observed.get(scope) ?? new Set<string>();
          for (const job of result.jobs) keys.add(sourceKeyOf(job));
          observed.set(scope, keys);

          /*
           * A scope is complete only if EVERY page covering it said so. One
           * partial page disqualifies the whole board permanently for this
           * run, because a diff against a partial list retires the jobs that
           * were merely on the page we did not get.
           */
          if (result.complete) {
            if (!partial.has(scope)) complete.add(scope);
          } else {
            partial.add(scope);
            complete.delete(scope);
          }
        }

        cursor = result.nextCursor;
        if (!cursor) break;
      }
    } catch (error) {
      // The sweep stopped early. Whatever was already ingested stays, the
      // scopes finished before the failure keep their completeness, and the
      // one that failed does not have it.
      fetchFailure = (error as Error).message;
      this.logger.warn(`Provider ${name} sweep failed: ${fetchFailure}`);
    }

    const runSucceeded = fetchFailure === null;
    for (const scope of complete) {
      try {
        const retired = await this.ingestion.markAbsent({
          provider: name,
          scopeKey: scope,
          observedSourceKeys: observed.get(scope) ?? new Set(),
          runSucceeded,
          absenceImpliesClosed: provider.descriptor.absenceImpliesClosed,
          now,
        });
        counters.closed += retired.jobsClosed;
      } catch (error) {
        // A failed retirement must not turn a good ingestion into a failed
        // run: the jobs were stored, and anything stale is caught next sweep.
        this.logger.warn(
          `Absence sweep failed for ${name}/${scope}: ${(error as Error).message}`,
        );
      }
    }

    const status = resolveRunStatus({
      fetchFailed: !runSucceeded,
      ingested: counters.created + counters.updated + counters.merged,
      failed: counters.failed,
    });
    const scopes = [...observed.keys()];

    await this.prisma.externalIngestionRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        sourceScope: scopes.join(',') || null,
        jobsFetched: counters.fetched,
        jobsCreated: counters.created,
        jobsUpdated: counters.updated,
        jobsMerged: counters.merged,
        jobsUnmerged: counters.unmerged,
        jobsClosed: counters.closed,
        jobsFailed: counters.failed,
        // A message. Never a payload, never a URL with a query string.
        error: fetchFailure,
      },
    });

    const durationMs = Date.now() - started;
    this.logger.log(
      `External sync ${name} ${status}: scopes=${scopes.length} ` +
        `fetched=${counters.fetched} created=${counters.created} ` +
        `updated=${counters.updated} merged=${counters.merged} ` +
        `unmerged=${counters.unmerged} closed=${counters.closed} ` +
        `failed=${counters.failed} ${durationMs}ms`,
    );

    return {
      runId: run.id,
      provider: name,
      scopes,
      status,
      durationMs,
      ...counters,
    };
  }

  /** Providers that are registered and runnable right now. */
  runnableProviders(): ExternalJobProvider[] {
    return this.registry.list();
  }
}

/**
 * What a run's numbers mean.
 *
 *   nothing ingested and the fetch died  -> FAILED
 *   the fetch died but jobs were stored  -> PARTIAL
 *   some postings failed                 -> PARTIAL
 *   everything worked                    -> SUCCEEDED
 *
 * PARTIAL is not a softer FAILED. It is the state that records "this run saw
 * an unknown fraction of the catalogue", so collapsing it into either
 * neighbour would either hide a real problem or invite closing jobs on
 * incomplete evidence.
 */
export function resolveRunStatus(input: {
  fetchFailed: boolean;
  ingested: number;
  failed: number;
}): ExternalIngestionStatus {
  if (input.fetchFailed) return input.ingested > 0 ? 'PARTIAL' : 'FAILED';
  return input.failed > 0 ? 'PARTIAL' : 'SUCCEEDED';
}
