import { ConfigService } from '@nestjs/config';
import { LoginAttemptsService } from './login-attempts.service';
import type { RedisService } from '../redis/redis.service';

/**
 * Deterministic in-memory Redis double: real INCR/EXPIRE/TTL/SET-EX/DEL/GET
 * semantics driven by a manual clock — no real minutes are ever waited.
 * (Methods are async purely to match the ioredis interface.)
 */
/* eslint-disable @typescript-eslint/require-await */
class FakeRedis {
  now = 0;
  private readonly values = new Map<string, string>();
  private readonly expiries = new Map<string, number>();

  advance(seconds: number) {
    this.now += seconds * 1000;
  }

  private alive(key: string): boolean {
    const at = this.expiries.get(key);
    if (at !== undefined && at <= this.now) {
      this.values.delete(key);
      this.expiries.delete(key);
      return false;
    }
    return this.values.has(key);
  }

  async incr(key: string): Promise<number> {
    const current = this.alive(key) ? Number(this.values.get(key)) : 0;
    const next = current + 1;
    this.values.set(key, String(next));
    if (current === 0) this.expiries.delete(key);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.alive(key)) return 0;
    this.expiries.set(key, this.now + seconds * 1000);
    return 1;
  }

  async set(
    key: string,
    value: string,
    mode?: string,
    seconds?: number,
  ): Promise<'OK'> {
    this.values.set(key, value);
    if (mode === 'EX' && seconds !== undefined) {
      this.expiries.set(key, this.now + seconds * 1000);
    } else {
      this.expiries.delete(key);
    }
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key) ? (this.values.get(key) ?? null) : null;
  }

  async ttl(key: string): Promise<number> {
    if (!this.alive(key)) return -2;
    const at = this.expiries.get(key);
    if (at === undefined) return -1;
    return Math.ceil((at - this.now) / 1000);
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.alive(key)) removed += 1;
      this.values.delete(key);
      this.expiries.delete(key);
    }
    return removed;
  }

  keys(): string[] {
    return [...this.values.keys()].filter((key) => this.alive(key));
  }
}
/* eslint-enable @typescript-eslint/require-await */

const IDENTITY = 'person@example.test';
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.9';

describe('LoginAttemptsService', () => {
  let redis: FakeRedis;
  let service: LoginAttemptsService;

  const build = (overrides: Record<string, number> = {}) => {
    redis = new FakeRedis();
    const config = {
      get: (key: string, fallback: number) =>
        overrides[key.replace('auth.lockout.', '')] ?? fallback,
    } as unknown as ConfigService;
    service = new LoginAttemptsService(
      { client: redis } as unknown as RedisService,
      config,
    );
  };

  beforeEach(() => build());

  const fail = (times: number, ip: string | null = IP) =>
    (async () => {
      for (let i = 0; i < times; i++) {
        await service.recordFailure(IDENTITY, ip);
      }
    })();

  it('attempts 1–4 do not lock', async () => {
    await fail(4);
    const state = await service.checkBeforeAttempt(IDENTITY, IP);
    expect(state).toEqual({ locked: false, retryAfterSeconds: 0 });
  });

  it('the 5th failure locks for 15 minutes with retryAfterSeconds', async () => {
    await fail(5);
    const state = await service.checkBeforeAttempt(IDENTITY, IP);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBe(900);
  });

  it('after the 15-minute lock expires, attempts are allowed again', async () => {
    await fail(5);
    redis.advance(900);
    const state = await service.checkBeforeAttempt(IDENTITY, IP);
    expect(state).toEqual({ locked: false, retryAfterSeconds: 0 });
  });

  it('3 more failures after the first lock escalate to 30 minutes', async () => {
    await fail(5);
    redis.advance(900);
    await fail(3);
    const state = await service.checkBeforeAttempt(IDENTITY, IP);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBe(1_800);
  });

  it('further abuse escalates to 60 minutes and NEVER beyond', async () => {
    await fail(5);
    redis.advance(900);
    await fail(3);
    redis.advance(1_800);
    for (let round = 0; round < 3; round++) {
      await fail(3);
      const state = await service.checkBeforeAttempt(IDENTITY, IP);
      expect(state.retryAfterSeconds).toBe(3_600);
      redis.advance(3_600);
    }
  });

  it('escalation memory decays after lock + failure window', async () => {
    await fail(5);
    // Past the lock (900) AND the escalation TTL (900 + 1800).
    redis.advance(2_701);
    await fail(4);
    expect((await service.checkBeforeAttempt(IDENTITY, IP)).locked).toBe(false);
    await fail(1);
    // Back at level 0: the 5th failure gives 15 minutes again, not 30.
    expect(
      (await service.checkBeforeAttempt(IDENTITY, IP)).retryAfterSeconds,
    ).toBe(900);
  });

  it('failure counters expire with the rolling window', async () => {
    await fail(4);
    redis.advance(1_801);
    await fail(4);
    expect((await service.checkBeforeAttempt(IDENTITY, IP)).locked).toBe(false);
  });

  it('success resets identity failure and escalation state', async () => {
    await fail(4);
    await service.recordSuccess(IDENTITY, IP);
    await fail(4);
    expect((await service.checkBeforeAttempt(IDENTITY, IP)).locked).toBe(false);
    // Escalation reset too: the next lock is the FIRST tier again.
    await fail(1);
    expect(
      (await service.checkBeforeAttempt(IDENTITY, IP)).retryAfterSeconds,
    ).toBe(900);
  });

  it('a pair lock from one IP does not lock the owner on another IP', async () => {
    await fail(5, IP);
    expect((await service.checkBeforeAttempt(IDENTITY, IP)).locked).toBe(true);
    expect((await service.checkBeforeAttempt(IDENTITY, OTHER_IP)).locked).toBe(
      false,
    );
  });

  it('identity-wide damper still stops a distributed attack on one account', async () => {
    build({ identityWideThreshold: 8 });
    for (let i = 0; i < 8; i++) {
      await service.recordFailure(IDENTITY, `198.51.100.${i}`);
    }
    // Now every vantage point on this identity is locked, including new IPs.
    expect(
      (await service.checkBeforeAttempt(IDENTITY, '192.0.2.1')).locked,
    ).toBe(true);
  });

  it('IP-wide damper rate-limits one address spraying many identities', async () => {
    build({ ipWideThreshold: 6 });
    for (let i = 0; i < 6; i++) {
      await service.recordFailure(`victim-${i}@example.test`, IP);
    }
    // A fresh identity from the abusive IP is locked …
    expect(
      (await service.checkBeforeAttempt('fresh@example.test', IP)).locked,
    ).toBe(true);
    // … while the same identity from a clean IP is not.
    expect(
      (await service.checkBeforeAttempt('fresh@example.test', OTHER_IP)).locked,
    ).toBe(false);
  });

  it('stores only hashed identifiers — no raw email or IP in any key', async () => {
    await fail(3);
    for (const key of redis.keys()) {
      expect(key).not.toContain(IDENTITY);
      expect(key).not.toContain('example.test');
      expect(key).not.toContain(IP);
      expect(key).toMatch(/^auth:login:(fail|esc|lock):[a-z-]+:[0-9a-f]{32}$/);
    }
  });

  it('a Redis outage fails open instead of blocking login', async () => {
    const broken = {
      client: {
        ttl: () => Promise.reject(new Error('down')),
        incr: () => Promise.reject(new Error('down')),
        del: () => Promise.reject(new Error('down')),
      },
    } as unknown as RedisService;
    const offline = new LoginAttemptsService(broken, {
      get: (_: string, fallback: number) => fallback,
    } as unknown as ConfigService);
    await expect(offline.checkBeforeAttempt(IDENTITY, IP)).resolves.toEqual({
      locked: false,
      retryAfterSeconds: 0,
    });
    await expect(offline.recordFailure(IDENTITY, IP)).resolves.toBeUndefined();
    await expect(offline.recordSuccess(IDENTITY, IP)).resolves.toBeUndefined();
  });
});
