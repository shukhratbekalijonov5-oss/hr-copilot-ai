import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Registry, collectDefaultMetrics, Gauge } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';
import { EXTERNAL_JOBS_QUEUE } from '../external-jobs/external-jobs.constants';
import { ExternalIndexService } from '../external-jobs/search/external-index.service';
import { ExternalProviderRegistry } from '../external-jobs/provider-registry';

/**
 * Prometheus metrics for the things only this service can know.
 *
 * ## Scope
 *
 * Request rate, latency and 5xx are NOT measured here. Traefik already
 * measures every request that reaches the API, from outside the process, and
 * a second in-process counter would only be a slightly-wrong copy of it. What
 * Traefik cannot see is the state this service owns: whether each external
 * provider actually completed a sync this hour, and whether the semantic
 * index has fallen behind PostgreSQL. That is what this file exposes.
 *
 * ## Cardinality
 *
 * Every label here is drawn from a closed set — `provider` is the
 * ExternalProvider enum, `state` is the BullMQ job states. No identifier of
 * any kind (candidate, vacancy, job, user, request) is ever a label: those
 * are unbounded and would turn one metric into millions of series.
 *
 * ## Query cost
 *
 * Values are refreshed on scrape but behind a TTL, so a scrape storm cannot
 * turn into a query storm — at one scrape per 30s this is a handful of
 * indexed aggregate queries per minute against small tables.
 */

/** Refresh at most this often, regardless of scrape frequency. */
const CACHE_TTL_MS = 25_000;

interface ProviderRunRow {
  provider: string;
  last_success: Date | null;
  last_finished: Date | null;
  failures_24h: bigint;
}

interface LatestRunRow {
  provider: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  private lastRefresh = 0;
  private refreshing: Promise<void> | null = null;

  private readonly lastSuccess = new Gauge({
    name: 'hrcopilot_external_sync_last_success_timestamp_seconds',
    help: 'Unix time of the last SUCCEEDED ingestion run for this provider (0 = never).',
    labelNames: ['provider'] as const,
    registers: [this.registry],
  });

  private readonly lastRun = new Gauge({
    name: 'hrcopilot_external_sync_last_run_timestamp_seconds',
    help: 'Unix time the last finished ingestion run for this provider ended (0 = never).',
    labelNames: ['provider'] as const,
    registers: [this.registry],
  });

  private readonly lastRunSuccess = new Gauge({
    name: 'hrcopilot_external_sync_last_run_success',
    help: 'Whether the most recent finished run for this provider SUCCEEDED (1) or not (0).',
    labelNames: ['provider'] as const,
    registers: [this.registry],
  });

  private readonly lastRunDuration = new Gauge({
    name: 'hrcopilot_external_sync_last_run_duration_seconds',
    help: 'Wall-clock duration of the most recent finished ingestion run.',
    labelNames: ['provider'] as const,
    registers: [this.registry],
  });

  private readonly failures24h = new Gauge({
    name: 'hrcopilot_external_sync_failed_runs_24h',
    help: 'Ingestion runs for this provider that ended FAILED or PARTIAL in the last 24h.',
    labelNames: ['provider'] as const,
    registers: [this.registry],
  });

  private readonly externalJobs = new Gauge({
    name: 'hrcopilot_external_jobs_total',
    help: 'External job rows in PostgreSQL — the authoritative live universe.',
    registers: [this.registry],
  });

  private readonly indexPending = new Gauge({
    name: 'hrcopilot_external_index_pending',
    help: 'Current external jobs whose semantic index entry is missing or older than the row.',
    registers: [this.registry],
  });

  private readonly queueJobs = new Gauge({
    name: 'hrcopilot_external_jobs_queue_jobs',
    help: 'Jobs on the external-jobs queue by state.',
    labelNames: ['state'] as const,
    registers: [this.registry],
  });

  /**
   * Which providers production actually schedules. Without this, an alert on
   * "no successful sync recently" would fire forever for a provider that was
   * deliberately switched off — and an alert that can never be resolved is an
   * alert everyone learns to ignore.
   */
  private readonly scheduled = new Gauge({
    name: 'hrcopilot_external_sync_scheduled',
    help: 'Whether this provider is currently configured and scheduled to sync (1) or not (0).',
    labelNames: ['provider'] as const,
    registers: [this.registry],
  });

  private readonly collectionOk = new Gauge({
    name: 'hrcopilot_metrics_collection_success',
    help: 'Whether the last metrics refresh completed without error (1) or failed (0).',
    registers: [this.registry],
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly index: ExternalIndexService,
    private readonly providers: ExternalProviderRegistry,
    @InjectQueue(EXTERNAL_JOBS_QUEUE) private readonly queue: Queue,
  ) {
    this.registry.setDefaultLabels({ service: 'backend' });
    collectDefaultMetrics({ register: this.registry });
  }

  /** Text exposition for the /metrics endpoint. */
  async scrape(): Promise<string> {
    await this.refresh();
    return this.registry.metrics();
  }

  /**
   * Refresh behind a TTL. Concurrent scrapes share one in-flight refresh
   * rather than each opening their own set of queries.
   */
  private async refresh(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRefresh < CACHE_TTL_MS) return;
    if (this.refreshing) return this.refreshing;

    this.refreshing = this.collect()
      .then(() => {
        this.collectionOk.set(1);
      })
      .catch((error: unknown) => {
        // A metrics failure must never become an application failure, and it
        // must never be silent either: the gauge says the numbers are stale.
        this.collectionOk.set(0);
        this.logger.warn(
          `Metrics refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      })
      .finally(() => {
        this.lastRefresh = Date.now();
        this.refreshing = null;
      });

    return this.refreshing;
  }

  private async collect(): Promise<void> {
    const [aggregates, latest, jobCount, pending, counts] = await Promise.all([
      this.prisma.$queryRaw<ProviderRunRow[]>`
        SELECT provider::text AS provider,
               MAX("finishedAt") FILTER (WHERE status = 'SUCCEEDED') AS last_success,
               MAX("finishedAt") AS last_finished,
               count(*) FILTER (
                 WHERE status IN ('FAILED', 'PARTIAL')
                   AND "startedAt" > now() - interval '24 hours'
               )::bigint AS failures_24h
        FROM external_ingestion_runs
        GROUP BY provider
      `,
      this.prisma.$queryRaw<LatestRunRow[]>`
        SELECT DISTINCT ON (provider)
               provider::text AS provider, status::text AS status,
               "startedAt", "finishedAt"
        FROM external_ingestion_runs
        WHERE "finishedAt" IS NOT NULL
        ORDER BY provider, "startedAt" DESC
      `,
      this.prisma.externalJob.count(),
      this.index.pendingCount(),
      this.queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      ),
    ]);

    // Reset first: a provider that is removed from configuration must stop
    // reporting a frozen "last success" forever.
    this.lastSuccess.reset();
    this.lastRun.reset();
    this.failures24h.reset();

    for (const row of aggregates) {
      const provider = row.provider;
      this.lastSuccess.set(
        { provider },
        row.last_success ? row.last_success.getTime() / 1000 : 0,
      );
      this.lastRun.set(
        { provider },
        row.last_finished ? row.last_finished.getTime() / 1000 : 0,
      );
      this.failures24h.set({ provider }, Number(row.failures_24h));
    }

    this.lastRunSuccess.reset();
    this.lastRunDuration.reset();
    for (const row of latest) {
      const provider = row.provider;
      this.lastRunSuccess.set({ provider }, row.status === 'SUCCEEDED' ? 1 : 0);
      if (row.finishedAt) {
        this.lastRunDuration.set(
          { provider },
          Math.max(
            0,
            (row.finishedAt.getTime() - row.startedAt.getTime()) / 1000,
          ),
        );
      }
    }

    // Runnable = configured; the registry omits providers with no sources.
    const runnable = new Set(
      this.providers.list().map((p) => p.descriptor.provider as string),
    );
    this.scheduled.reset();
    for (const provider of new Set([
      ...runnable,
      ...aggregates.map((row) => row.provider),
    ])) {
      this.scheduled.set({ provider }, runnable.has(provider) ? 1 : 0);
    }

    this.externalJobs.set(jobCount);
    this.indexPending.set(pending);

    this.queueJobs.reset();
    for (const [state, value] of Object.entries(counts)) {
      this.queueJobs.set({ state }, Number(value ?? 0));
    }
  }
}
