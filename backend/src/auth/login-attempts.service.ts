import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

/**
 * Password-login abuse protection: TTL-backed failure counters and
 * temporary locks in Redis. Process memory is never the authority, so the
 * policy holds across replicas and restarts.
 *
 * ## Scoping — why three counters
 *
 * A naive identity-only lock hands an attacker a denial-of-service button:
 * five wrong passwords lock the victim out. Instead:
 *
 *  - (identity, IP) PAIR — the primary escalating policy (5 → 15 min,
 *    then 3 → 30 min, then 3 → 60 min cap). An attacker tripping it locks
 *    only their own vantage point; the real owner on their own IP is
 *    untouched.
 *  - IP-wide — a higher damper (default 30 failures/window) against one
 *    address spraying many identities.
 *  - identity-wide — a higher damper (default 20 failures/window) against
 *    a distributed attack on one account. This one CAN affect the real
 *    owner, which is exactly why its threshold is deliberately far above
 *    the pair threshold.
 *
 * Keys carry SHA-256 hashes of the normalized identity/IP — no raw email
 * or address ever appears in Redis or in logs.
 *
 * ## Failure behavior
 *
 * Redis being unreachable fails OPEN with a warning: login availability is
 * judged more important than lockout enforcement during an outage, and the
 * global request throttler still applies.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name);

  private readonly firstThreshold: number;
  private readonly firstLockSeconds: number;
  private readonly secondThreshold: number;
  private readonly secondLockSeconds: number;
  private readonly maxLockSeconds: number;
  private readonly failureWindowSeconds: number;
  private readonly ipWideThreshold: number;
  private readonly identityWideThreshold: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.firstThreshold = config.get<number>('auth.lockout.firstThreshold', 5);
    this.firstLockSeconds = config.get<number>(
      'auth.lockout.firstLockSeconds',
      900,
    );
    this.secondThreshold = config.get<number>(
      'auth.lockout.secondThreshold',
      3,
    );
    this.secondLockSeconds = config.get<number>(
      'auth.lockout.secondLockSeconds',
      1_800,
    );
    this.maxLockSeconds = config.get<number>(
      'auth.lockout.maxLockSeconds',
      3_600,
    );
    this.failureWindowSeconds = config.get<number>(
      'auth.lockout.failureWindowSeconds',
      1_800,
    );
    this.ipWideThreshold = config.get<number>(
      'auth.lockout.ipWideThreshold',
      30,
    );
    this.identityWideThreshold = config.get<number>(
      'auth.lockout.identityWideThreshold',
      20,
    );
  }

  /**
   * Cheap pre-check, run BEFORE the user lookup and password hash: a locked
   * caller never costs a bcrypt comparison. Returns the longest remaining
   * lock across every scope the caller matches.
   */
  async checkBeforeAttempt(
    identity: string,
    ip: string | null | undefined,
  ): Promise<{ locked: boolean; retryAfterSeconds: number }> {
    try {
      const ttls = await Promise.all(
        this.lockKeys(identity, ip).map((key) => this.redis.client.ttl(key)),
      );
      const retryAfterSeconds = Math.max(0, ...ttls);
      return { locked: retryAfterSeconds > 0, retryAfterSeconds };
    } catch (error) {
      this.failOpen('check', error);
      return { locked: false, retryAfterSeconds: 0 };
    }
  }

  /** A wrong password (or unknown identity — externally identical). */
  async recordFailure(
    identity: string,
    ip: string | null | undefined,
  ): Promise<void> {
    try {
      await Promise.all(
        this.scopes(identity, ip).map((scope) => this.bumpScope(scope)),
      );
    } catch (error) {
      this.failOpen('record-failure', error);
    }
  }

  /**
   * A verified password clears the identity-scoped state (pair counter,
   * pair escalation, identity-wide counter). The IP-wide counter is NOT
   * forgiven: one valid account behind an address does not vouch for the
   * other identities being sprayed from it.
   */
  async recordSuccess(
    identity: string,
    ip: string | null | undefined,
  ): Promise<void> {
    try {
      const pair = this.pairScope(identity, ip);
      const identityWide = this.identityScope(identity);
      await this.redis.client.del(
        this.failKey(pair),
        this.escalationKey(pair),
        this.failKey(identityWide),
        this.escalationKey(identityWide),
      );
    } catch (error) {
      this.failOpen('record-success', error);
    }
  }

  // ---------------------------------------------------------------- scopes

  private scopes(identity: string, ip: string | null | undefined): Scope[] {
    const scopes = [this.pairScope(identity, ip), this.identityScope(identity)];
    if (ip) {
      scopes.push({
        name: `ip:${hash(ip)}`,
        threshold: this.ipWideThreshold,
        escalates: true,
      });
    }
    return scopes;
  }

  private pairScope(identity: string, ip: string | null | undefined): Scope {
    return {
      name: `id-ip:${hash(`${identity}|${ip ?? 'no-ip'}`)}`,
      threshold: this.firstThreshold,
      escalates: true,
    };
  }

  private identityScope(identity: string): Scope {
    return {
      name: `identity:${hash(identity)}`,
      threshold: this.identityWideThreshold,
      escalates: true,
    };
  }

  private lockKeys(identity: string, ip: string | null | undefined): string[] {
    return this.scopes(identity, ip).map((scope) => this.lockKey(scope));
  }

  // ---------------------------------------------------------------- policy

  /**
   * Count a failure for one scope; lock it when its threshold is reached.
   * Escalation: threshold 5 at level 0, then 3; lock 15 min → 30 min →
   * 60 min, capped at 60. The wide scopes reuse the same lock ladder but
   * with their own (higher) entry thresholds.
   */
  private async bumpScope(scope: Scope): Promise<void> {
    const failKey = this.failKey(scope);
    const failures = await this.redis.client.incr(failKey);
    if (failures === 1) {
      await this.redis.client.expire(failKey, this.failureWindowSeconds);
    }

    const level = Number(
      (await this.redis.client.get(this.escalationKey(scope))) ?? '0',
    );
    const threshold =
      level === 0
        ? scope.threshold
        : Math.min(scope.threshold, this.secondThreshold);
    if (failures < threshold) {
      return;
    }

    const lockSeconds = this.lockSecondsForLevel(level);
    await this.redis.client.set(this.lockKey(scope), '1', 'EX', lockSeconds);
    // The lock consumed this batch of failures; the next round starts
    // counting from zero at the higher escalation level.
    await this.redis.client.del(failKey);
    if (scope.escalates) {
      // Escalation memory outlives the lock by a full failure window, then
      // decays — yesterday's abuse does not haunt next month's typo.
      await this.redis.client.set(
        this.escalationKey(scope),
        String(Math.min(level + 1, 2)),
        'EX',
        lockSeconds + this.failureWindowSeconds,
      );
    }
  }

  private lockSecondsForLevel(level: number): number {
    const bySteps =
      level <= 0
        ? this.firstLockSeconds
        : level === 1
          ? this.secondLockSeconds
          : this.maxLockSeconds;
    return Math.min(bySteps, this.maxLockSeconds);
  }

  // ------------------------------------------------------------------ keys

  private failKey(scope: Scope): string {
    return `auth:login:fail:${scope.name}`;
  }

  private escalationKey(scope: Scope): string {
    return `auth:login:esc:${scope.name}`;
  }

  private lockKey(scope: Scope): string {
    return `auth:login:lock:${scope.name}`;
  }

  /** Never include key material (hashed or not) in the log line. */
  private failOpen(operation: string, error: unknown): void {
    this.logger.warn(
      `Login attempt tracking unavailable (${operation}): ${
        (error as Error).message
      }`,
    );
  }
}

interface Scope {
  name: string;
  threshold: number;
  escalates: boolean;
}

/** SHA-256, hex, truncated — irreversible, collision-safe at this scale. */
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
