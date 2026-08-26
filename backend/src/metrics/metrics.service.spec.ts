import { MetricsService } from './metrics.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ExternalIndexService } from '../external-jobs/search/external-index.service';
import type { Queue } from 'bullmq';
import type { ExternalProviderRegistry } from '../external-jobs/provider-registry';

/**
 * What these tests defend:
 *  - the exposition is real Prometheus text with the series alerts key on;
 *  - a provider label set is the closed enum, never an unbounded id;
 *  - a database failure degrades the metrics, never the process;
 *  - the TTL means a scrape storm is not a query storm.
 */

const HOUR_AGO = new Date(Date.now() - 3_600_000);
const DAY_AGO = new Date(Date.now() - 86_400_000);

function build(over: { fail?: boolean } = {}) {
  const queryRaw = jest.fn().mockImplementation(() => {
    if (over.fail) return Promise.reject(new Error('db down'));
    return Promise.resolve([]);
  });
  const prisma = {
    $queryRaw: queryRaw,
    externalJob: { count: jest.fn().mockResolvedValue(1792) },
  } as unknown as PrismaService;

  // Two different shapes come back from the two raw queries.
  if (!over.fail) {
    queryRaw
      .mockResolvedValueOnce([
        {
          provider: 'GREENHOUSE',
          last_success: HOUR_AGO,
          last_finished: HOUR_AGO,
          failures_24h: 0n,
        },
        {
          provider: 'LEVER',
          last_success: DAY_AGO,
          last_finished: HOUR_AGO,
          failures_24h: 2n,
        },
      ])
      .mockResolvedValueOnce([
        {
          provider: 'GREENHOUSE',
          status: 'SUCCEEDED',
          startedAt: new Date(HOUR_AGO.getTime() - 12_000),
          finishedAt: HOUR_AGO,
        },
        {
          provider: 'LEVER',
          status: 'FAILED',
          startedAt: new Date(HOUR_AGO.getTime() - 5_000),
          finishedAt: HOUR_AGO,
        },
      ]);
  }

  const index = {
    pendingCount: jest.fn().mockResolvedValue(0),
  } as unknown as ExternalIndexService;
  const queue = {
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 3,
      failed: 0,
      completed: 41,
    }),
  } as unknown as Queue;

  // GREENHOUSE and LEVER are configured; a provider with history but no
  // configured sources must report scheduled=0, not vanish.
  const registry = {
    list: () => [
      { descriptor: { provider: 'GREENHOUSE' } },
      { descriptor: { provider: 'LEVER' } },
    ],
  } as unknown as ExternalProviderRegistry;

  return {
    service: new MetricsService(prisma, index, registry, queue),
    prisma,
    queue,
  };
}

describe('MetricsService', () => {
  it('exposes the external sync series alerting depends on', async () => {
    const { service } = build();
    const text = await service.scrape();

    expect(text).toContain(
      'hrcopilot_external_sync_last_success_timestamp_seconds{provider="GREENHOUSE",service="backend"}',
    );
    expect(text).toContain(
      'hrcopilot_external_sync_last_run_success{provider="LEVER",service="backend"} 0',
    );
    expect(text).toContain(
      'hrcopilot_external_sync_failed_runs_24h{provider="LEVER",service="backend"} 2',
    );
    expect(text).toContain(
      'hrcopilot_external_jobs_total{service="backend"} 1792',
    );
    expect(text).toContain(
      'hrcopilot_external_index_pending{service="backend"} 0',
    );
    expect(text).toContain(
      'hrcopilot_external_jobs_queue_jobs{state="failed",service="backend"} 0',
    );
    expect(text).toContain(
      'hrcopilot_metrics_collection_success{service="backend"} 1',
    );
  });

  it('reports a switched-off provider as scheduled=0 rather than omitting it', async () => {
    const { service } = build();
    const text = await service.scrape();
    expect(text).toContain(
      'hrcopilot_external_sync_scheduled{provider="GREENHOUSE",service="backend"} 1',
    );
    expect(text).toContain(
      'hrcopilot_external_sync_scheduled{provider="LEVER",service="backend"} 1',
    );
  });

  it('keeps every label inside a closed set — no identifiers', async () => {
    const { service } = build();
    const text = await service.scrape();
    const labels = new Set<string>();
    for (const match of text.matchAll(/^hrcopilot_[a-z_0-9]+\{([^}]*)\}/gm)) {
      for (const pair of match[1].split(',')) {
        const name = pair.split('=')[0].trim();
        if (name) labels.add(name);
      }
    }
    expect([...labels].sort()).toEqual(['provider', 'service', 'state']);
    for (const forbidden of [
      'candidateId',
      'vacancyId',
      'jobId',
      'userId',
      'requestId',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('degrades honestly when the database is unavailable', async () => {
    const { service } = build({ fail: true });
    const text = await service.scrape();
    // Serving stale-but-flagged numbers beats failing the scrape.
    expect(text).toContain(
      'hrcopilot_metrics_collection_success{service="backend"} 0',
    );
    expect(text).toContain('nodejs_eventloop_lag_seconds');
  });

  it('a scrape storm is not a query storm', async () => {
    const { service, queue } = build();
    await Promise.all([service.scrape(), service.scrape(), service.scrape()]);
    await service.scrape();
    expect((queue.getJobCounts as jest.Mock).mock.calls.length).toBe(1);
  });
});
