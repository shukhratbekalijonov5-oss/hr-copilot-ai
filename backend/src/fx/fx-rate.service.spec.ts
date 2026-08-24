import { ConfigService } from '@nestjs/config';
import {
  FX_REFRESH_LOCK_KEY,
  FX_SNAPSHOT_KEY,
  FxRateService,
  versionOf,
} from './fx-rate.service';
import { HttpFxRateProvider, type FetchLike } from './fx-rate.provider';

/**
 * The rate cache: one atomic snapshot, an honest age, and a provider outage
 * that costs freshness rather than the product.
 */

function configOf(values: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

function redisMock() {
  const store = new Map<string, string>();
  return {
    store,
    client: {
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: string, ...rest: unknown[]) => {
        // Mirrors ioredis: SET key value PX ms NX only writes when absent.
        if (rest.includes('NX') && store.has(key)) return Promise.resolve(null);
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      }),
    },
  };
}

function providerMock(
  rates: Record<string, number> = { KRW: 1390, CAD: 1.36 },
) {
  return {
    configured: true,
    fetchLatest: jest.fn().mockResolvedValue({
      baseCurrency: 'USD',
      rates,
      providerTimestamp: '2026-08-22T12:00:00Z',
    }),
  };
}

function build(overrides: { redis?: any; provider?: any } = {}) {
  const redis = overrides.redis ?? redisMock();
  const provider = overrides.provider ?? providerMock();
  const service = new FxRateService(
    redis as never,
    provider as never,
    configOf(),
  );
  return { service, redis, provider };
}

/** Writes a snapshot as if it had been fetched `ageMs` ago. */
function seed(redis: ReturnType<typeof redisMock>, ageMs: number) {
  const rates = { KRW: 1390, CAD: 1.36 };
  redis.store.set(
    FX_SNAPSHOT_KEY,
    JSON.stringify({
      baseCurrency: 'USD',
      rates,
      fetchedAt: new Date(Date.now() - ageMs).toISOString(),
      providerTimestamp: null,
      snapshotVersion: versionOf('USD', rates),
    }),
  );
}

describe('refresh', () => {
  it('fetches, validates and writes ONE document', async () => {
    const { service, redis } = build();

    const snapshot = await service.refresh();

    expect(snapshot?.rates.KRW).toBe(1390);
    // One SET of one key: a reader sees the old table or the new one, never
    // a mixture of both.
    expect(redis.client.set).toHaveBeenCalledTimes(1);
    expect(redis.client.set.mock.calls[0][0]).toBe(FX_SNAPSHOT_KEY);
    expect(
      JSON.parse(redis.client.set.mock.calls[0][1] as string),
    ).toMatchObject({ baseCurrency: 'USD' });
  });

  it('records fetchedAt, the provider timestamp and a content version', async () => {
    const { service } = build();
    const snapshot = await service.refresh();
    expect(snapshot?.fetchedAt).toBeTruthy();
    expect(snapshot?.providerTimestamp).toBe('2026-08-22T12:00:00Z');
    expect(snapshot?.snapshotVersion).toHaveLength(64);
  });

  it('KEEPS the last known good snapshot when the provider fails', async () => {
    // The whole point of a cache: an outage costs freshness, never the
    // ability to compare a salary.
    const redis = redisMock();
    seed(redis, 60_000);
    const before = redis.store.get(FX_SNAPSHOT_KEY);
    const provider = providerMock();
    provider.fetchLatest.mockRejectedValue(new Error('provider down'));
    const { service } = build({ redis, provider });

    await expect(service.refresh()).resolves.toBeNull();

    expect(redis.store.get(FX_SNAPSHOT_KEY)).toBe(before);
    const view = await service.current();
    expect(view.freshness).toBe('FRESH');
    expect(view.table?.rates.KRW).toBe(1390);
  });

  it('does nothing at all when no provider is configured', async () => {
    const provider = { configured: false, fetchLatest: jest.fn() };
    const { service, redis } = build({ provider });

    await expect(service.refresh()).resolves.toBeNull();

    expect(provider.fetchLatest).not.toHaveBeenCalled();
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it('never puts the credential in a log line or an error', async () => {
    const provider = providerMock();
    provider.fetchLatest.mockRejectedValue(
      new Error('Exchange-rate provider responded 401'),
    );
    const { service } = build({ provider });
    const warn = jest
      .spyOn(
        (service as never as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await service.refresh();

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toMatch(/api[_-]?key/i);
    expect(logged).toContain('401');
    warn.mockRestore();
  });
});

describe('freshness', () => {
  it('a table from 5 minutes ago is FRESH and usable', async () => {
    const redis = redisMock();
    seed(redis, 5 * 60_000);
    const { service } = build({ redis });

    const view = await service.current();

    expect(view.freshness).toBe('FRESH');
    expect(view.table).not.toBeNull();
  });

  it('a table from 2 hours ago is STALE_USABLE and still compares', async () => {
    // Rates move by fractions of a percent in a day. Refusing to compare
    // because the table is two hours old tells the candidate less than a
    // slightly stale number does.
    const redis = redisMock();
    seed(redis, 2 * 3600_000);
    const { service } = build({ redis });

    const view = await service.current();

    expect(view.freshness).toBe('STALE_USABLE');
    expect(view.table).not.toBeNull();
  });

  it('a table from 12 hours ago is UNAVAILABLE and is NOT handed out', async () => {
    const redis = redisMock();
    seed(redis, 12 * 3600_000);
    const { service } = build({ redis });

    const view = await service.current();

    expect(view.freshness).toBe('UNAVAILABLE');
    expect(view.table).toBeNull();
  });

  it('no snapshot at all is UNAVAILABLE', async () => {
    const { service } = build();
    await expect(service.current()).resolves.toMatchObject({
      freshness: 'UNAVAILABLE',
      table: null,
    });
  });

  it('corrupt JSON reads as UNAVAILABLE rather than throwing', async () => {
    const redis = redisMock();
    redis.store.set(FX_SNAPSHOT_KEY, '{not json');
    const { service } = build({ redis });

    await expect(service.current()).resolves.toMatchObject({
      freshness: 'UNAVAILABLE',
    });
  });

  it('Redis being down degrades salary comparison and nothing else', async () => {
    const redis = redisMock();
    redis.client.get.mockRejectedValue(new Error('redis down'));
    const { service } = build({ redis });

    // Never throws: ranking a page must not fail over a rate table.
    await expect(service.current()).resolves.toMatchObject({
      freshness: 'UNAVAILABLE',
      table: null,
    });
  });
});

describe('ensureSnapshot', () => {
  it('serves the cache without touching the provider', async () => {
    const redis = redisMock();
    seed(redis, 60_000);
    const { service, provider } = build({ redis });

    const view = await service.ensureSnapshot();

    expect(view.freshness).toBe('FRESH');
    expect(provider.fetchLatest).not.toHaveBeenCalled();
  });

  it('refreshes exactly ONCE when ten callers arrive on a cold cache', async () => {
    // The stampede this prevents: ten simultaneous Job Match requests turning
    // into ten calls to a third party.
    const { service, provider } = build();

    const views = await Promise.all(
      Array.from({ length: 10 }, () => service.ensureSnapshot()),
    );

    expect(provider.fetchLatest).toHaveBeenCalledTimes(1);
    expect(views.filter((v) => v.table !== null).length).toBeGreaterThan(0);
  });

  it('releases the lock so a later cold start can still refresh', async () => {
    const { service, redis, provider } = build();

    await service.ensureSnapshot();
    expect(redis.store.has(FX_REFRESH_LOCK_KEY)).toBe(false);

    redis.store.delete(FX_SNAPSHOT_KEY);
    await service.ensureSnapshot();
    expect(provider.fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('a failed cold-start refresh returns UNAVAILABLE without throwing', async () => {
    const provider = providerMock();
    provider.fetchLatest.mockRejectedValue(new Error('timeout'));
    const { service } = build({ provider });

    await expect(service.ensureSnapshot()).resolves.toMatchObject({
      freshness: 'UNAVAILABLE',
      table: null,
    });
  });
});

describe('versionOf', () => {
  it('is content-based: identical rates keep an identical version', () => {
    // What stops a 30-minute refresh cycle from looking like constant change
    // to anything recording which rates it used.
    expect(versionOf('USD', { KRW: 1390, CAD: 1.36 })).toBe(
      versionOf('USD', { CAD: 1.36, KRW: 1390 }),
    );
  });

  it('changes when a rate actually moves', () => {
    expect(versionOf('USD', { KRW: 1390 })).not.toBe(
      versionOf('USD', { KRW: 1391 }),
    );
  });

  it('changes when the base currency changes', () => {
    expect(versionOf('USD', { KRW: 1390 })).not.toBe(
      versionOf('EUR', { KRW: 1390 }),
    );
  });
});

describe('HttpFxRateProvider', () => {
  const fetchOf = (impl: FetchLike) => impl;

  function providerWith(
    response: unknown,
    { ok = true, status = 200 } = {},
    url = 'https://rates.example/v1/{key}/latest/{base}',
  ) {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(response),
    });
    const provider = new HttpFxRateProvider(
      configOf({
        'exchangeRates.baseUrl': url,
        'exchangeRates.apiKey': 'secret-key-value',
        'exchangeRates.baseCurrency': 'USD',
        'exchangeRates.requestTimeoutMs': 50,
      }),
      fetchOf(fetchImpl),
    );
    return { provider, fetchImpl };
  }

  it('reports itself unconfigured when no URL is set', () => {
    const { provider } = providerWith({}, {}, '');
    expect(provider.configured).toBe(false);
  });

  it('refuses to fetch when unconfigured rather than guessing an endpoint', async () => {
    // An API key does not identify its provider. Guessing would post a real
    // credential to a service that may not be the one it belongs to.
    const { provider, fetchImpl } = providerWith({}, {}, '');
    await expect(provider.fetchLatest()).rejects.toThrow(
      /no exchange-rate provider/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a `conversion_rates` table', async () => {
    const { provider } = providerWith({
      base_code: 'USD',
      conversion_rates: { KRW: 1390, CAD: 1.36 },
      time_last_update_utc: 'Fri, 22 Aug 2026 00:00:01 +0000',
    });
    await expect(provider.fetchLatest()).resolves.toMatchObject({
      baseCurrency: 'USD',
      rates: { KRW: 1390 },
      providerTimestamp: 'Fri, 22 Aug 2026 00:00:01 +0000',
    });
  });

  it('accepts a `rates` table with a unix timestamp', async () => {
    const { provider } = providerWith({
      base: 'USD',
      rates: { KRW: 1390 },
      timestamp: 1_787_000_000,
    });
    const fetched = await provider.fetchLatest();
    expect(fetched.rates.KRW).toBe(1390);
    expect(fetched.providerTimestamp).toContain('T');
  });

  it('drops junk keys and non-positive values instead of importing them', async () => {
    const { provider } = providerWith({
      rates: {
        KRW: 1390,
        __proto__: 5,
        'not-a-code': 3,
        BAD: -1,
        ZERO: 0,
        NAH: 'abc',
      },
    });
    const fetched = await provider.fetchLatest();
    expect(Object.keys(fetched.rates)).toEqual(['KRW']);
  });

  it('rejects a response with no rate table', async () => {
    const { provider } = providerWith({ success: true });
    await expect(provider.fetchLatest()).rejects.toThrow(/no rate table/i);
  });

  it('rejects a table with nothing usable in it', async () => {
    const { provider } = providerWith({ rates: { BAD: -1 } });
    await expect(provider.fetchLatest()).rejects.toThrow(/no usable rates/i);
  });

  it('rejects 429 and 5xx by status, without echoing the body', async () => {
    for (const status of [429, 500, 503]) {
      const { provider } = providerWith({}, { ok: false, status });
      await expect(provider.fetchLatest()).rejects.toThrow(String(status));
    }
  });

  it('aborts a hung request rather than holding a refresh open', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const provider = new HttpFxRateProvider(
      configOf({
        'exchangeRates.baseUrl': 'https://rates.example/{key}',
        'exchangeRates.apiKey': 'k',
        'exchangeRates.requestTimeoutMs': 20,
      }),
      fetchImpl as unknown as FetchLike,
    );

    await expect(provider.fetchLatest()).rejects.toThrow();
  });

  it('substitutes the key into the URL and never returns or logs it', async () => {
    const { provider, fetchImpl } = providerWith({ rates: { KRW: 1390 } });

    const fetched = await provider.fetchLatest();

    // The credential is in the request (that is its job) …
    expect(fetchImpl.mock.calls[0][0]).toContain('secret-key-value');
    // … and nowhere in what comes back out.
    expect(JSON.stringify(fetched)).not.toContain('secret-key-value');
  });
});
