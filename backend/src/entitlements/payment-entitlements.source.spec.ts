import { ConfigService } from '@nestjs/config';
import { PaymentServiceClient } from './payment-service.client';
import { PaymentServiceEntitlementsSource } from './payment-entitlements.source';
import type { RedisService } from '../redis/redis.service';

/**
 * The Payment Service plan source: fail-closed in every direction, cached
 * briefly, never influenced by anything a client could send.
 */

function configOf(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, fallback: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function redisFake() {
  const store = new Map<string, string>();
  return {
    store,
    service: {
      client: {
        get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
        set: jest.fn((key: string, value: string) => {
          store.set(key, value);
          return Promise.resolve('OK');
        }),
        del: jest.fn((key: string) => {
          store.delete(key);
          return Promise.resolve(1);
        }),
      },
    } as unknown as RedisService,
  };
}

function clientReturning(result: unknown): PaymentServiceClient {
  return {
    configured: true,
    entitlementsFor: jest.fn(() => Promise.resolve(result)),
  } as unknown as PaymentServiceClient;
}

const ENTITLED = {
  userId: 'user-1',
  plan: 'MAX',
  capabilities: ['INTERNAL_AI_SEARCH', 'EXTERNAL_AI_SEARCH'],
  subscriptionStatus: 'ACTIVE',
  effectiveUntil: null,
  version: 3,
};

describe('fail-closed resolution', () => {
  it('maps a valid response to its plan', async () => {
    const source = new PaymentServiceEntitlementsSource(
      clientReturning(ENTITLED),
      redisFake().service,
      configOf(),
    );
    expect(await source.planFor('user-1')).toBe('MAX');
  });

  it('answers FREE when the service is unreachable — never a guess', async () => {
    const source = new PaymentServiceEntitlementsSource(
      clientReturning(null),
      redisFake().service,
      configOf(),
    );
    expect(await source.planFor('user-1')).toBe('FREE');
  });

  it('does NOT cache an outage — access returns the moment the service does', async () => {
    const client = {
      configured: true,
      entitlementsFor: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(ENTITLED),
    } as unknown as PaymentServiceClient;
    const source = new PaymentServiceEntitlementsSource(
      client,
      redisFake().service,
      configOf(),
    );
    expect(await source.planFor('user-1')).toBe('FREE');
    expect(await source.planFor('user-1')).toBe('MAX');
  });
});

describe('the bounded cache', () => {
  it('serves a repeat from cache without a second service call', async () => {
    const client = clientReturning(ENTITLED);
    const source = new PaymentServiceEntitlementsSource(
      client,
      redisFake().service,
      configOf(),
    );
    await source.planFor('user-1');
    await source.planFor('user-1');
    expect(client.entitlementsFor).toHaveBeenCalledTimes(1);
  });

  it('invalidate(userId) drops exactly that entry', async () => {
    const client = clientReturning(ENTITLED);
    const redis = redisFake();
    const source = new PaymentServiceEntitlementsSource(
      client,
      redis.service,
      configOf(),
    );
    await source.planFor('user-1');
    await source.invalidate('user-1');
    await source.planFor('user-1');
    expect(client.entitlementsFor).toHaveBeenCalledTimes(2);
  });

  it('clamps the TTL to five minutes whatever is configured', () => {
    const redis = redisFake();
    const source = new PaymentServiceEntitlementsSource(
      clientReturning(ENTITLED),
      redis.service,
      configOf({ 'entitlements.cacheTtlSeconds': 86_400 }),
    );
    return source.planFor('user-1').then(() => {
      const set = redis.service.client.set as unknown as jest.Mock;
      expect(set.mock.calls[0][3]).toBeLessThanOrEqual(300);
    });
  });

  it('a Redis outage degrades to a lookup, never an error', async () => {
    const client = clientReturning(ENTITLED);
    const redis = redisFake();
    (redis.service.client.get as jest.Mock).mockRejectedValue(
      new Error('redis down'),
    );
    const source = new PaymentServiceEntitlementsSource(
      client,
      redis.service,
      configOf(),
    );
    expect(await source.planFor('user-1')).toBe('MAX');
  });

  it('ignores a corrupted cache value', async () => {
    const client = clientReturning(ENTITLED);
    const redis = redisFake();
    redis.store.set('entitlements:plan:user-1', 'SUPERMAX');
    const source = new PaymentServiceEntitlementsSource(
      client,
      redis.service,
      configOf(),
    );
    expect(await source.planFor('user-1')).toBe('MAX');
    expect(client.entitlementsFor).toHaveBeenCalledTimes(1);
  });
});

describe('the HTTP client validates before it trusts', () => {
  function clientWith(fetchImpl: typeof fetch): PaymentServiceClient {
    global.fetch = fetchImpl;
    return new PaymentServiceClient(
      configOf({
        'entitlements.paymentServiceUrl': 'http://payments.internal:8081',
        'entitlements.paymentServiceToken': 'svc-token',
        'entitlements.timeoutMs': 50,
      }),
    );
  }

  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('a timeout fails closed as null', async () => {
    const client = clientWith(
      ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('AbortError')),
          );
        })) as unknown as typeof fetch,
    );
    expect(await client.entitlementsFor('user-1')).toBeNull();
  });

  it('a non-200 fails closed', async () => {
    const client = clientWith((() =>
      Promise.resolve({ ok: false, status: 500 })) as unknown as typeof fetch);
    expect(await client.entitlementsFor('user-1')).toBeNull();
  });

  it('an unknown plan value fails closed', async () => {
    const client = clientWith((() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...ENTITLED, plan: 'ULTRA' }),
      })) as unknown as typeof fetch);
    expect(await client.entitlementsFor('user-1')).toBeNull();
  });

  it('a mismatched userId echo fails closed', async () => {
    const client = clientWith((() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...ENTITLED, userId: 'other' }),
      })) as unknown as typeof fetch);
    expect(await client.entitlementsFor('user-1')).toBeNull();
  });

  it('sends the service credential and nothing client-derived', async () => {
    let seen: RequestInit | undefined;
    const client = clientWith(((_url: string, init: RequestInit) => {
      seen = init;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(ENTITLED),
      });
    }) as unknown as typeof fetch);

    await client.entitlementsFor('user-1');
    expect(seen?.headers).toEqual({ 'X-Internal-Token': 'svc-token' });
  });

  it('reports unconfigured as null without a network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    const client = new PaymentServiceClient(configOf());
    expect(await client.entitlementsFor('user-1')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
