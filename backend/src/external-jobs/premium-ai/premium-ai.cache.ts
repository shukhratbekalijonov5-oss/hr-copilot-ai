import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isSupportedLocale } from '../../ai/ai-service.client';
import type { SupportedLocale } from '../../ai/ai-service.client';
import {
  PREMIUM_AI_CACHE_PREFIX,
  PREMIUM_AI_CACHE_TTL_SECONDS,
} from './external-premium-ai.policy';

/**
 * The cache-and-locale plumbing every MAX premium feature shares.
 *
 * Why-match, Cover Letter and Interview Prep differ only in what they ask a
 * model for. How a request resolves its language, how a cached answer is
 * addressed, and how a Redis outage degrades are the SAME contract for all
 * of them, and keeping that contract in one place is what keeps it true:
 *
 * - **Key** = `premium-ai:<feature-version>:<locale>:<fingerprint>`. The
 *   fingerprint comes from `ExternalPremiumAiContextService` and is the Rule
 *   N1 mechanism — a candidate or job change makes the old key unreachable.
 *   The version is IN the key, so bumping it after a prompt/shape change
 *   invalidates without a migration; the locale is in the key, so a Korean
 *   answer never satisfies an English ask.
 * - **Read** degrades to a miss on any Redis error or malformed value —
 *   never to an error, never to a stale answer.
 * - **Write** failure costs a re-generation next time, never the answer the
 *   candidate is waiting for.
 * - **TTL** is cleanup, not correctness (see the policy module).
 */
@Injectable()
export class PremiumAiCacheService {
  private readonly logger = new Logger(PremiumAiCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** The account's own language, defaulting to English. */
  async preferredLocale(userId: string): Promise<SupportedLocale> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLocale: true },
    });
    const locale = user?.preferredLocale;
    return locale && isSupportedLocale(locale) ? locale : 'en';
  }

  key(version: string, locale: SupportedLocale, fingerprint: string): string {
    return [PREMIUM_AI_CACHE_PREFIX, version, locale, fingerprint].join(':');
  }

  /**
   * Parsed value or null. The CALLER validates the shape — this layer only
   * guarantees that whatever comes back parsed as JSON, and that a cache
   * outage reads as a miss.
   */
  async read<T>(key: string): Promise<T | null> {
    let raw: string | null;
    try {
      raw = await this.redis.client.get(key);
    } catch (error) {
      this.logger.warn(
        `Premium-AI cache read failed, generating instead: ${
          (error as Error).message
        }`,
      );
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async write(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.client.set(
        key,
        JSON.stringify(value),
        'EX',
        PREMIUM_AI_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Premium-AI cache write failed: ${(error as Error).message}`,
      );
    }
  }
}
