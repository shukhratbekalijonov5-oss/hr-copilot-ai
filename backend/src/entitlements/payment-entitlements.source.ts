import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { PaymentServiceClient } from './payment-service.client';
import { CANDIDATE_PLANS } from './candidate-plan.policy';
import type { CandidatePlan } from '../generated/prisma/enums';
import type { EntitlementsSource } from './entitlements-source';

/**
 * The Payment Service as plan source, with a short bounded cache.
 *
 * ## Cache discipline
 *
 * TTL is deliberately SHORT (default 120s, configurable, hard-capped at
 * 5 minutes): a cache entry is a window in which a plan change is not yet
 * visible, and an authorization window must stay small. Only SUCCESSFUL
 * lookups are cached — an outage is never memoized, so premium access
 * returns the moment the service does. `invalidate(userId)` drops one
 * user's entry; the Kafka ENTITLEMENT_CHANGED consumer (next task) calls
 * it to close the window early. Redis being down simply means every lookup
 * goes to the service — a latency cost, never a correctness one.
 *
 * ## Fail closed
 *
 * The client returns null for every unreadable state, and null maps to
 * FREE here. A payment-service outage denies premium features for its
 * duration; it cannot grant anything.
 */
@Injectable()
export class PaymentServiceEntitlementsSource implements EntitlementsSource {
  private readonly logger = new Logger(PaymentServiceEntitlementsSource.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly client: PaymentServiceClient,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = Math.min(
      300,
      Math.max(0, config.get<number>('entitlements.cacheTtlSeconds', 120)),
    );
  }

  private key(userId: string): string {
    return `entitlements:plan:${userId}`;
  }

  async planFor(userId: string): Promise<CandidatePlan> {
    const cached = await this.read(userId);
    if (cached) return cached;

    const entitlements = await this.client.entitlementsFor(userId);
    if (!entitlements) return 'FREE'; // Unknown truth grants nothing.

    await this.write(userId, entitlements.plan);
    return entitlements.plan;
  }

  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.client.del(this.key(userId));
    } catch (error) {
      this.logger.warn(
        `Entitlement cache invalidation failed: ${(error as Error).message}`,
      );
    }
  }

  private async read(userId: string): Promise<CandidatePlan | null> {
    if (this.ttlSeconds === 0) return null;
    try {
      const raw = await this.redis.client.get(this.key(userId));
      if (raw && (CANDIDATE_PLANS as readonly string[]).includes(raw)) {
        return raw as CandidatePlan;
      }
      return null;
    } catch {
      return null; // Cache outage reads as a miss, never as an error.
    }
  }

  private async write(userId: string, plan: CandidatePlan): Promise<void> {
    if (this.ttlSeconds === 0) return;
    try {
      await this.redis.client.set(
        this.key(userId),
        plan,
        'EX',
        this.ttlSeconds,
      );
    } catch {
      // A write failure costs a lookup next time, nothing else.
    }
  }
}
