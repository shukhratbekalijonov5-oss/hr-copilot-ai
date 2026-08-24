import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, logLevel } from 'kafkajs';
import { RedisService } from '../redis/redis.service';
import { ENTITLEMENTS_SOURCE } from './entitlements-source';
import type { EntitlementsSource } from './entitlements-source';

/** The one topic this consumer reads — the Java outbox publishes it. */
export const ENTITLEMENT_EVENTS_TOPIC = 'billing.entitlement-events.v1';

/** The envelope version this deploy understands. */
export const SUPPORTED_EVENT_VERSION = 1;

/** How long a seen eventId is remembered. Far beyond any redelivery window. */
const DEDUPE_TTL_MS = 24 * 60 * 60_000;

/**
 * The Kafka side of entitlement propagation: when the Java Payment Service
 * commits a plan change, its transactional outbox publishes
 * ENTITLEMENT_CHANGED here, and this consumer closes the local cache window
 * early instead of waiting out the TTL.
 *
 * ## Kafka is a doorbell, not a source of truth
 *
 * The ONLY effect of any event is `invalidate(userId)` — dropping one
 * user's cached plan so the next entitlement read fetches the Payment
 * Service over authenticated HTTP. No code path here reads a plan,
 * capability or status out of the payload and stores it: a fabricated or
 * corrupt message can therefore cost one cache hit and nothing else. That
 * asymmetry is what makes every failure mode below safe to resolve in the
 * "process it" direction.
 *
 * ## Idempotency and failure policy
 *
 * Events are deduplicated on `eventId` (Redis SET NX, 24h). But because
 * invalidation is naturally idempotent — invalidating twice equals
 * invalidating once — dedupe is an efficiency, not a correctness
 * requirement, and its failure mode is chosen accordingly: when the dedupe
 * store cannot answer, the event is PROCESSED anyway. Skipping on a dedupe
 * error could silently drop a real entitlement change; processing a
 * duplicate costs one extra cache miss. The dedupe store and the cache are
 * the SAME Redis, which closes the remaining gap: if Redis is down and an
 * invalidation is lost, there is also no cache to serve a stale plan —
 * every read already falls through to the Payment Service.
 *
 * A malformed message (unparseable JSON, no usable userId) is logged at
 * error level and acknowledged — a poison message must not wedge the
 * partition behind it. An event with an UNSUPPORTED version but a readable
 * userId is still processed: newer envelope versions may add fields, and
 * the conservative reading of "an entitlement changed, shape unknown" is
 * to drop the cache, never to keep serving it. Event types other than
 * ENTITLEMENT_CHANGED are acknowledged without action.
 *
 * Because every content-determined path resolves without throwing,
 * offsets always commit, the consumer never hot-loops, and at-least-once
 * delivery from the outbox meets an idempotent effect — which is the
 * whole contract.
 *
 * ## Operations
 *
 * Off unless `ENTITLEMENTS_KAFKA_BROKERS` is set (a laptop without a broker
 * runs zero Kafka code). The group id is stable by default so redeploys
 * resume committed offsets. Connection is established in the background —
 * a broker outage at boot must not stop the API — with kafkajs's bounded
 * exponential retry underneath, and the consumer disconnects gracefully on
 * shutdown.
 */
@Injectable()
export class EntitlementEventsConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EntitlementEventsConsumer.name);
  private readonly brokers: string[];
  private readonly groupId: string;
  private consumer: Consumer | null = null;

  constructor(
    @Inject(ENTITLEMENTS_SOURCE) private readonly source: EntitlementsSource,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.brokers = config
      .get<string>('entitlements.kafkaBrokers', '')
      .split(',')
      .map((broker) => broker.trim())
      .filter((broker) => broker.length > 0);
    this.groupId = config.get<string>(
      'entitlements.kafkaConsumerGroup',
      'hr-copilot-backend.entitlements',
    );
  }

  get enabled(): boolean {
    return this.brokers.length > 0;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'Entitlement events consumer off (no ENTITLEMENTS_KAFKA_BROKERS)',
      );
      return;
    }
    // Background on purpose: an unreachable broker delays entitlement
    // PROPAGATION (the ≤5-minute cache TTL still bounds it) — it must not
    // delay or fail API boot.
    void this.start().catch((error: Error) => {
      this.logger.error(
        `Entitlement events consumer failed to start: ${error.message}`,
      );
    });
  }

  private async start(): Promise<void> {
    const kafka = new Kafka({
      clientId: 'hr-copilot-backend',
      brokers: this.brokers,
      logLevel: logLevel.ERROR,
      retry: { initialRetryTime: 300, retries: 8 },
    });
    this.consumer = kafka.consumer({ groupId: this.groupId });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: ENTITLEMENT_EVENTS_TOPIC,
      fromBeginning: false,
    });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        await this.handleMessage(message.value?.toString('utf8') ?? null);
      },
    });
    this.logger.log(
      `Consuming ${ENTITLEMENT_EVENTS_TOPIC} as group ${this.groupId}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.consumer) return;
    try {
      await this.consumer.disconnect();
    } catch (error) {
      this.logger.warn(
        `Kafka consumer disconnect failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Process one raw message. Public and transport-free so the decision
   * table is unit-testable without a broker. No message CONTENT can make it
   * throw — malformed, foreign, duplicated and future-versioned payloads
   * all resolve (see the class doc). The one propagating failure is a
   * throwing `invalidate`, and that propagation is deliberate: the offset
   * is then not committed and consumer semantics retry, because an
   * entitlement change must not be silently lost. (Neither real source
   * throws: the payment source catches internally, DbPlanSource no-ops.)
   *
   * Returns what was done, for tests and for log truthfulness.
   */
  async handleMessage(
    raw: string | null,
  ): Promise<'invalidated' | 'duplicate' | 'ignored' | 'malformed'> {
    if (raw === null || raw.trim().length === 0) {
      this.logger.error('Entitlement event with an empty payload; skipped');
      return 'malformed';
    }

    let envelope: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        this.logger.error('Entitlement event was not a JSON object; skipped');
        return 'malformed';
      }
      envelope = parsed as Record<string, unknown>;
    } catch {
      this.logger.error('Entitlement event was not valid JSON; skipped');
      return 'malformed';
    }

    const eventType =
      typeof envelope.eventType === 'string' ? envelope.eventType : '';
    if (eventType !== 'ENTITLEMENT_CHANGED') {
      // Not ours to act on. Acknowledged so the partition moves; logged so
      // an unexpected type on this topic is visible.
      this.logger.debug?.(
        `Ignoring event type '${eventType || '(missing)'}' on ${ENTITLEMENT_EVENTS_TOPIC}`,
      );
      return 'ignored';
    }

    const userId = typeof envelope.userId === 'string' ? envelope.userId : '';
    if (userId.length === 0) {
      this.logger.error(
        'ENTITLEMENT_CHANGED event carried no userId; nothing to invalidate',
      );
      return 'malformed';
    }

    if (envelope.eventVersion !== SUPPORTED_EVENT_VERSION) {
      // Unknown shape, but the meaning "this user's entitlements changed"
      // is readable — and the only action is dropping a cache entry, which
      // is safe under ANY future version. Conservative = still invalidate.
      this.logger.warn(
        `ENTITLEMENT_CHANGED with unsupported eventVersion ${String(
          envelope.eventVersion,
        )}; invalidating cache anyway`,
      );
    }

    const eventId =
      typeof envelope.eventId === 'string' && envelope.eventId.length > 0
        ? envelope.eventId
        : null;
    if (eventId && (await this.alreadySeen(eventId))) {
      return 'duplicate';
    }

    // The one and only effect. `invalidate` is itself failure-tolerant
    // (a Redis outage there also disables the cache it would have cleared).
    await this.source.invalidate(userId);
    this.logger.log(
      `Entitlement cache invalidated for a user (event received)`,
    );
    return 'invalidated';
  }

  /** True only when the dedupe store POSITIVELY remembers this eventId. */
  private async alreadySeen(eventId: string): Promise<boolean> {
    try {
      const claimed = await this.redis.client.set(
        `entitlements:event:${eventId}`,
        '1',
        'PX',
        DEDUPE_TTL_MS,
        'NX',
      );
      return claimed === null;
    } catch (error) {
      // Dedupe unavailable → process anyway; see the class doc.
      this.logger.warn(
        `Event dedupe store unavailable (${(error as Error).message}); processing without dedupe`,
      );
      return false;
    }
  }
}
