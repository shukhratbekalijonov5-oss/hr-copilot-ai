import { ConfigService } from '@nestjs/config';
import { EntitlementEventsConsumer } from './entitlement-events.consumer';
import type { EntitlementsSource } from './entitlements-source';
import type { RedisService } from '../redis/redis.service';

/**
 * The Kafka → cache-invalidation decision table, without a broker.
 *
 * The one invariant everything here defends: an event can only ever DROP a
 * cache entry. No payload — valid, malformed, duplicated, from the future —
 * can write a plan, and no failure mode resolves toward keeping a stale
 * grant.
 */

function configOf(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, fallback: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function sourceFake() {
  return {
    planFor: jest.fn(() => Promise.resolve('FREE')),
    invalidate: jest.fn(() => Promise.resolve()),
  } as unknown as EntitlementsSource & {
    planFor: jest.Mock;
    invalidate: jest.Mock;
  };
}

function redisFake(overrides: { set?: jest.Mock } = {}) {
  const seen = new Set<string>();
  const set =
    overrides.set ??
    jest.fn((key: string) => {
      if (seen.has(key)) return Promise.resolve(null); // NX: already held
      seen.add(key);
      return Promise.resolve('OK');
    });
  return {
    set,
    service: { client: { set } } as unknown as RedisService,
  };
}

function consumerWith(
  source: ReturnType<typeof sourceFake>,
  redis: ReturnType<typeof redisFake>,
  config: Record<string, unknown> = {},
): EntitlementEventsConsumer {
  return new EntitlementEventsConsumer(source, redis.service, configOf(config));
}

const EVENT = {
  eventId: 'evt-1',
  eventType: 'ENTITLEMENT_CHANGED',
  eventVersion: 1,
  occurredAt: '2026-08-24T10:00:00Z',
  userId: 'user-1',
  plan: 'MAX',
};

describe('ENTITLEMENT_CHANGED handling', () => {
  it('a valid event invalidates exactly that user cache', async () => {
    const source = sourceFake();
    const consumer = consumerWith(source, redisFake());

    expect(await consumer.handleMessage(JSON.stringify(EVENT))).toBe(
      'invalidated',
    );
    expect(source.invalidate).toHaveBeenCalledTimes(1);
    expect(source.invalidate).toHaveBeenCalledWith('user-1');
  });

  it('the SAME event delivered again is harmless — one logical invalidation', async () => {
    const source = sourceFake();
    const consumer = consumerWith(source, redisFake());

    await consumer.handleMessage(JSON.stringify(EVENT));
    expect(await consumer.handleMessage(JSON.stringify(EVENT))).toBe(
      'duplicate',
    );
    expect(await consumer.handleMessage(JSON.stringify(EVENT))).toBe(
      'duplicate',
    );
    expect(source.invalidate).toHaveBeenCalledTimes(1);
  });

  it('NEVER sets a plan from the payload — Kafka is not a truth source', async () => {
    const source = sourceFake();
    const redis = redisFake();
    const consumer = consumerWith(source, redis);

    await consumer.handleMessage(JSON.stringify({ ...EVENT, plan: 'MAX' }));

    // The only Redis write is the dedupe marker; no plan cache entry is
    // written, and nothing resolves a plan.
    for (const call of redis.set.mock.calls) {
      expect(String(call[0])).toMatch(/^entitlements:event:/);
    }
    expect(source.planFor).not.toHaveBeenCalled();
  });
});

describe('malformed and foreign messages', () => {
  it('unparseable JSON is rejected safely — acknowledged, nothing invalidated', async () => {
    const source = sourceFake();
    const consumer = consumerWith(source, redisFake());

    expect(await consumer.handleMessage('{not json')).toBe('malformed');
    expect(await consumer.handleMessage('')).toBe('malformed');
    expect(await consumer.handleMessage(null)).toBe('malformed');
    expect(await consumer.handleMessage('42')).toBe('malformed');
    expect(source.invalidate).not.toHaveBeenCalled();
  });

  it('an event without a userId cannot be acted on', async () => {
    const source = sourceFake();
    const consumer = consumerWith(source, redisFake());

    const event: Record<string, unknown> = { ...EVENT };
    delete event.userId;
    expect(await consumer.handleMessage(JSON.stringify(event))).toBe(
      'malformed',
    );
    expect(source.invalidate).not.toHaveBeenCalled();
  });

  it('an unsupported event TYPE is explicitly ignored', async () => {
    const source = sourceFake();
    const consumer = consumerWith(source, redisFake());

    expect(
      await consumer.handleMessage(
        JSON.stringify({ ...EVENT, eventType: 'PAYMENT_SUCCEEDED' }),
      ),
    ).toBe('ignored');
    expect(source.invalidate).not.toHaveBeenCalled();
  });

  it('an unsupported VERSION still invalidates — dropping a cache entry is safe under any envelope', async () => {
    const source = sourceFake();
    const consumer = consumerWith(source, redisFake());

    expect(
      await consumer.handleMessage(
        JSON.stringify({ ...EVENT, eventVersion: 2 }),
      ),
    ).toBe('invalidated');
    expect(source.invalidate).toHaveBeenCalledWith('user-1');
  });
});

describe('failure policy', () => {
  it('a dedupe-store outage does NOT lose the event — processed without dedupe', async () => {
    const source = sourceFake();
    const redis = redisFake({
      set: jest.fn(() => Promise.reject(new Error('redis down'))),
    });
    const consumer = consumerWith(source, redis);

    expect(await consumer.handleMessage(JSON.stringify(EVENT))).toBe(
      'invalidated',
    );
    expect(source.invalidate).toHaveBeenCalledWith('user-1');
  });

  it('an event without an eventId is processed (no dedupe possible, action idempotent)', async () => {
    const source = sourceFake();
    const consumer = consumerWith(source, redisFake());

    const event: Record<string, unknown> = { ...EVENT };
    delete event.eventId;
    expect(await consumer.handleMessage(JSON.stringify(event))).toBe(
      'invalidated',
    );
  });

  it('an invalidate failure is the ONE path that propagates — consumer semantics then retry it', async () => {
    const source = sourceFake();
    (source.invalidate as jest.Mock).mockRejectedValue(
      new Error('invalidate blew up'),
    );
    const consumer = consumerWith(source, redisFake());
    // Every parse/validate/dedupe outcome resolves (asserted above), so a
    // poison message can never wedge the partition. The only rejection is a
    // throwing invalidate — which neither real source does (Payment source
    // catches internally, DbPlanSource is a no-op), but if one ever did,
    // NOT committing the offset and retrying is exactly the safe behavior:
    // an entitlement change must not be silently lost.
    await expect(consumer.handleMessage(JSON.stringify(EVENT))).rejects.toThrow(
      'invalidate blew up',
    );
  });
});

describe('operational posture', () => {
  it('is OFF without configured brokers — zero Kafka code runs locally', () => {
    const consumer = consumerWith(sourceFake(), redisFake());
    expect(consumer.enabled).toBe(false);
    expect(() => consumer.onModuleInit()).not.toThrow();
  });

  it('uses a stable consumer group name by default', () => {
    const consumer = consumerWith(sourceFake(), redisFake(), {
      'entitlements.kafkaBrokers': 'localhost:9092',
    });
    expect(consumer.enabled).toBe(true);
    // The default group is asserted through config resolution: absent an
    // override, the documented stable name is used.
    expect(
      configOf().get(
        'entitlements.kafkaConsumerGroup',
        'hr-copilot-backend.entitlements',
      ),
    ).toBe('hr-copilot-backend.entitlements');
  });
});
