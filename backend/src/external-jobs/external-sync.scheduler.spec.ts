import { ConfigService } from '@nestjs/config';
import { ExternalSyncScheduler } from './external-sync.scheduler';
import {
  EXTERNAL_JOB_REVALIDATE_JOB,
  EXTERNAL_PROVIDER_SYNC_JOB,
  EXTERNAL_REVALIDATE_SCHEDULER_ID,
} from './external-jobs.constants';
import type { ExternalProviderRegistry } from './provider-registry';
import type { Queue } from 'bullmq';

/**
 * Restart safety of the provider schedule.
 *
 * The queue here is a stateful fake that mimics the ONE BullMQ property the
 * fix depends on (verified against the installed bullmq 6.1.2 Lua): an
 * upsert REPLACES the scheduler's pending iteration — immediately for a new
 * scheduler, a full interval later for an existing one. The scheduler class
 * must therefore not upsert at all when Redis already holds exactly the
 * schedule this boot wants; these tests pin that behavior.
 */

const SIX_HOURS = 6 * 60 * 60_000;
const ONE_HOUR = 60 * 60_000;

interface FakeScheduler {
  key: string;
  name: string;
  every: number;
  next: number;
  template: { data: Record<string, unknown> };
  upserts: number;
}

function fakeQueue() {
  const store = new Map<string, FakeScheduler>();
  const queue = {
    store,
    getJobScheduler: jest.fn((id: string) =>
      Promise.resolve(store.get(id) ?? undefined),
    ),
    upsertJobScheduler: jest.fn(
      (
        id: string,
        opts: { every: number },
        template: { name: string; data: Record<string, unknown> },
      ) => {
        const existing = store.get(id);
        store.set(id, {
          key: id,
          name: template.name,
          every: opts.every,
          // The measured bullmq semantics: a fresh scheduler runs NOW; an
          // upsert over an existing one reschedules a full interval later.
          next: existing ? existing.next + opts.every : Date.now(),
          template: { data: template.data },
          upserts: (existing?.upserts ?? 0) + 1,
        });
        return Promise.resolve({});
      },
    ),
    removeJobScheduler: jest.fn((id: string) =>
      Promise.resolve(store.delete(id)),
    ),
  };
  return queue as typeof queue & { store: Map<string, FakeScheduler> };
}

function registryOf(names: string[]): ExternalProviderRegistry {
  return {
    list: () => names.map((name) => ({ descriptor: { provider: name } })),
  } as unknown as ExternalProviderRegistry;
}

function configOf(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

const ENABLED = {
  'externalJobs.scheduleEnabled': true,
  'externalJobs.syncIntervalMs': SIX_HOURS,
  'externalJobs.revalidateIntervalMs': ONE_HOUR,
};

function boot(
  queue: ReturnType<typeof fakeQueue>,
  options: {
    providers?: string[];
    config?: Record<string, unknown>;
  } = {},
) {
  const scheduler = new ExternalSyncScheduler(
    queue as unknown as Queue,
    registryOf(options.providers ?? ['GREENHOUSE', 'LEVER', 'ASHBY']),
    configOf(options.config ?? ENABLED),
  );
  return scheduler.onModuleInit();
}

describe('first registration', () => {
  it('creates exactly one scheduler per configured provider, plus revalidation', async () => {
    const queue = fakeQueue();
    await boot(queue);

    expect([...queue.store.keys()].sort()).toEqual([
      'external-revalidate',
      'external-sync:ashby',
      'external-sync:greenhouse',
      'external-sync:lever',
    ]);
    for (const provider of ['greenhouse', 'lever', 'ashby']) {
      const entry = queue.store.get(`external-sync:${provider}`)!;
      expect(entry.every).toBe(SIX_HOURS);
      expect(entry.name).toBe(EXTERNAL_PROVIDER_SYNC_JOB);
      expect(entry.template.data).toEqual({
        provider: provider.toUpperCase(),
      });
      expect(entry.upserts).toBe(1);
    }
    const revalidate = queue.store.get(EXTERNAL_REVALIDATE_SCHEDULER_ID)!;
    expect(revalidate.every).toBe(ONE_HOUR);
    expect(revalidate.name).toBe(EXTERNAL_JOB_REVALIDATE_JOB);
  });

  it('schedules nothing for NINEHIRE and COMPANY_CAREERS when they are not runnable', async () => {
    const queue = fakeQueue();
    await boot(queue);
    expect(queue.store.has('external-sync:ninehire')).toBe(false);
    expect(queue.store.has('external-sync:company_careers')).toBe(false);
  });

  it('removes the leftover schedule of a provider no longer runnable', async () => {
    const queue = fakeQueue();
    await boot(queue, {
      providers: ['GREENHOUSE', 'LEVER', 'ASHBY', 'NINEHIRE'],
    });
    expect(queue.store.has('external-sync:ninehire')).toBe(true);

    // Next deploy dropped Ninehire from configuration: its standing schedule
    // must not keep sweeping a provider nobody configured.
    await boot(queue);
    expect(queue.store.has('external-sync:ninehire')).toBe(false);
    expect(queue.store.size).toBe(4);
  });
});

describe('restart safety — the reason this class exists', () => {
  it('a second boot performs NO upsert and preserves the pending next run', async () => {
    const queue = fakeQueue();
    await boot(queue);
    const before = new Map(
      [...queue.store.values()].map((entry) => [entry.key, entry.next]),
    );
    queue.upsertJobScheduler.mockClear();

    await boot(queue);

    // No write at all: the pending iteration in Redis is left untouched, so
    // a restart cannot trigger an immediate sweep NOR push the schedule out.
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    for (const entry of queue.store.values()) {
      expect(entry.next).toBe(before.get(entry.key));
      expect(entry.upserts).toBe(1);
    }
  });

  it('a crash loop of ten boots still writes each scheduler exactly once', async () => {
    const queue = fakeQueue();
    for (let i = 0; i < 10; i += 1) await boot(queue);

    for (const entry of queue.store.values()) {
      expect(entry.upserts).toBe(1);
    }
  });

  it('two replicas booting produce one scheduler per provider, not two', async () => {
    const queue = fakeQueue();
    await Promise.all([boot(queue), boot(queue)]);

    expect(queue.store.size).toBe(4);
    expect(
      [...queue.store.keys()].filter((k) => k.includes('greenhouse')),
    ).toHaveLength(1);
  });

  it('keeps every provider on the SAME interval — no per-provider drift', async () => {
    const queue = fakeQueue();
    await boot(queue);
    await boot(queue);
    const intervals = [...queue.store.values()]
      .filter((entry) => entry.name === EXTERNAL_PROVIDER_SYNC_JOB)
      .map((entry) => entry.every);
    expect(new Set(intervals).size).toBe(1);
    expect(intervals[0]).toBe(SIX_HOURS);
  });

  it('a DELIBERATE interval change is applied (and only then)', async () => {
    const queue = fakeQueue();
    await boot(queue);

    await boot(queue, {
      config: { ...ENABLED, 'externalJobs.syncIntervalMs': 12 * 60 * 60_000 },
    });
    const greenhouse = queue.store.get('external-sync:greenhouse')!;
    expect(greenhouse.every).toBe(12 * 60 * 60_000);
    expect(greenhouse.upserts).toBe(2);

    // And once applied, further boots preserve again.
    await boot(queue, {
      config: { ...ENABLED, 'externalJobs.syncIntervalMs': 12 * 60 * 60_000 },
    });
    expect(queue.store.get('external-sync:greenhouse')!.upserts).toBe(2);
  });
});

describe('the enable/disable switch', () => {
  it('disabling removes every schedule, including revalidation and stale providers', async () => {
    const queue = fakeQueue();
    await boot(queue);
    expect(queue.store.size).toBe(4);

    await boot(queue, {
      config: { ...ENABLED, 'externalJobs.scheduleEnabled': false },
    });
    expect(queue.store.size).toBe(0);
    // And no upsert happened on the disabled boot.
    const upserts = [...queue.store.values()].reduce(
      (sum, entry) => sum + entry.upserts,
      0,
    );
    expect(upserts).toBe(0);
  });

  it('re-enabling after a disable restores exactly one scheduler per provider', async () => {
    const queue = fakeQueue();
    await boot(queue);
    await boot(queue, {
      config: { ...ENABLED, 'externalJobs.scheduleEnabled': false },
    });
    await boot(queue);

    expect(queue.store.size).toBe(4);
    for (const entry of queue.store.values()) expect(entry.upserts).toBe(1);
  });

  it('registers nothing at all when no provider is configured', async () => {
    const queue = fakeQueue();
    await boot(queue, { providers: [] });
    expect(queue.store.size).toBe(0);
    expect(queue.getJobScheduler).not.toHaveBeenCalled();
  });

  it('one provider failing to schedule does not stop the others', async () => {
    const queue = fakeQueue();
    queue.upsertJobScheduler.mockImplementationOnce(() =>
      Promise.reject(new Error('redis hiccup')),
    );
    await boot(queue);
    // Greenhouse failed; Lever, Ashby and revalidation still landed.
    expect(queue.store.size).toBe(3);
  });
});
