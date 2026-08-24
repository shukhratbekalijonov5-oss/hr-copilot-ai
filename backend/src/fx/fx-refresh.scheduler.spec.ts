import { ConfigService } from '@nestjs/config';
import { FxRefreshScheduler } from './fx-refresh.scheduler';
import { FxRefreshProcessor } from './fx-refresh.processor';
import { FX_REFRESH_JOB, FX_REFRESH_REPEAT_KEY } from './fx.constants';

/**
 * One refresh cycle, registered idempotently, plus a warm start.
 *
 * The failure this guards against is a schedule that multiplies: every deploy
 * adding another repeatable until a third-party API is being called far more
 * often than anyone intended.
 */

function configOf(values: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function build(overrides: { configured?: boolean; every?: number } = {}) {
  const queue = { upsertJobScheduler: jest.fn().mockResolvedValue({}) };
  const rates = {
    providerConfigured: overrides.configured ?? true,
    ensureSnapshot: jest.fn().mockResolvedValue({ freshness: 'FRESH' }),
  };
  const scheduler = new FxRefreshScheduler(
    queue as never,
    rates as never,
    configOf(
      overrides.every
        ? { 'exchangeRates.refreshIntervalMs': overrides.every }
        : {},
    ),
  );
  return { scheduler, queue, rates };
}

describe('FxRefreshScheduler', () => {
  it('registers a repeat every 30 minutes by default', async () => {
    const { scheduler, queue } = build();

    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      FX_REFRESH_REPEAT_KEY,
      { every: 30 * 60_000 },
      { name: FX_REFRESH_JOB },
    );
  });

  it('honours a configured interval', async () => {
    const { scheduler, queue } = build({ every: 5 * 60_000 });

    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler.mock.calls[0][1]).toEqual({
      every: 5 * 60_000,
    });
  });

  it('re-registering does not create a SECOND cycle', async () => {
    // upsert with a fixed key replaces the schedule. Ten restarts converge on
    // one cycle instead of ten.
    const { scheduler, queue } = build();

    await scheduler.onModuleInit();
    await scheduler.onModuleInit();
    await scheduler.onModuleInit();

    const keys = new Set(
      queue.upsertJobScheduler.mock.calls.map((call) => call[0] as string),
    );
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(FX_REFRESH_REPEAT_KEY);
  });

  it('warms a cold cache once at boot, through the locked path', async () => {
    const { scheduler, rates } = build();

    await scheduler.onModuleInit();

    // ensureSnapshot, not refresh: it no-ops when a usable table exists and
    // is itself locked, so several instances booting together make one call.
    expect(rates.ensureSnapshot).toHaveBeenCalledTimes(1);
  });

  it('schedules nothing when no provider is configured', async () => {
    const { scheduler, queue, rates } = build({ configured: false });

    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(rates.ensureSnapshot).not.toHaveBeenCalled();
  });

  it('a queue that refuses the schedule does not stop the app booting', async () => {
    const { scheduler, queue } = build();
    queue.upsertJobScheduler.mockRejectedValue(new Error('redis down'));

    await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
  });
});

describe('FxRefreshProcessor', () => {
  it('reports the new version when a refresh lands', async () => {
    const rates = {
      refresh: jest.fn().mockResolvedValue({ snapshotVersion: 'abc123' }),
    };
    const processor = new FxRefreshProcessor(rates as never);

    await expect(
      processor.process({ name: FX_REFRESH_JOB } as never),
    ).resolves.toEqual({ refreshed: true, version: 'abc123' });
  });

  it('does NOT fail the job when the provider is down', async () => {
    // A provider outage is an expected condition, not a failed job: the
    // previous snapshot survives and the next tick tries again. Failing would
    // add retry noise on top of a wait that is already scheduled.
    const rates = { refresh: jest.fn().mockResolvedValue(null) };
    const processor = new FxRefreshProcessor(rates as never);

    await expect(
      processor.process({ name: FX_REFRESH_JOB } as never),
    ).resolves.toEqual({ refreshed: false });
  });
});
