import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { FxRateProvider } from './fx-rate.provider';
import type { RateTable } from './money';

/** The one key holding the current rate table. */
export const FX_SNAPSHOT_KEY = 'fx:rates:latest';
/** Held while one process refreshes, so ten requests cause one provider call. */
export const FX_REFRESH_LOCK_KEY = 'fx:rates:refreshing';

/** Rates this recent are simply current. */
export const FX_FRESH_MS = 30 * 60_000;
/**
 * Older than fresh but still usable. Exchange rates move by fractions of a
 * percent in a day; refusing to compare a salary because the table is 90
 * minutes old would tell a candidate less than a slightly stale number does.
 * Beyond this, the product stops guessing and says so.
 */
export const FX_STALE_USABLE_MS = 6 * 3600_000;

export type FxFreshness = 'FRESH' | 'STALE_USABLE' | 'UNAVAILABLE';

export interface FxSnapshot extends RateTable {
  fetchedAt: string;
  providerTimestamp: string | null;
  /** Content hash of the table: identical rates keep an identical version. */
  snapshotVersion: string;
}

export interface FxSnapshotView {
  snapshot: FxSnapshot | null;
  freshness: FxFreshness;
  ageMs: number | null;
  /** The table to convert with, or null when nothing trustworthy exists. */
  table: RateTable | null;
}

const UNAVAILABLE: FxSnapshotView = {
  snapshot: null,
  freshness: 'UNAVAILABLE',
  ageMs: null,
  table: null,
};

/**
 * The current exchange-rate snapshot: refreshing it, caching it, and saying
 * honestly how old it is.
 *
 * ## One snapshot, written whole
 *
 * Rates live under a single Redis key holding one JSON document. A reader
 * therefore either sees the previous table or the next one, never half of
 * each — a partially-updated table would silently mix rates from two moments
 * and produce comparisons that were never true at any instant.
 *
 * ## Last-known-good beats nothing
 *
 * A failed refresh keeps the previous snapshot. The alternative — clearing it
 * — would turn a provider outage into "no salary can be compared", which is
 * strictly worse information than a table from an hour ago. Only genuinely old
 * or missing data becomes UNAVAILABLE, and even then the product's answer is
 * SALARY_NOT_COMPARABLE: the job still ranks and is still shown.
 *
 * ## The key is never observable
 *
 * The credential lives in config, is used only to build a request URL inside
 * the provider, and appears in no log line, no error message and no API
 * response. Failures are reported by status code and message only.
 */
@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private lastFailureReason: string | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly provider: FxRateProvider,
    private readonly config: ConfigService,
  ) {}

  get providerConfigured(): boolean {
    return this.provider.configured;
  }

  /**
   * The snapshot as it stands, with its age.
   *
   * Never throws and never fetches: ranking a page of jobs must not block on a
   * third-party HTTP call. Redis being down reads as UNAVAILABLE, which
   * degrades salary comparison and nothing else.
   */
  async current(): Promise<FxSnapshotView> {
    let raw: string | null = null;
    try {
      raw = await this.redis.client.get(FX_SNAPSHOT_KEY);
    } catch (error) {
      this.logger.warn(
        `Could not read the FX snapshot: ${(error as Error).message}`,
      );
      return UNAVAILABLE;
    }
    if (!raw) return UNAVAILABLE;

    let snapshot: FxSnapshot;
    try {
      snapshot = JSON.parse(raw) as FxSnapshot;
    } catch {
      return UNAVAILABLE;
    }
    if (!snapshot?.rates || !snapshot.fetchedAt) return UNAVAILABLE;

    const ageMs = Date.now() - Date.parse(snapshot.fetchedAt);
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      // A clock that disagrees with the stored timestamp is not a reason to
      // throw the table away; treat it as just-fetched.
      return {
        snapshot,
        freshness: 'FRESH',
        ageMs: 0,
        table: snapshot,
      };
    }
    const freshness: FxFreshness =
      ageMs <= FX_FRESH_MS
        ? 'FRESH'
        : ageMs <= FX_STALE_USABLE_MS
          ? 'STALE_USABLE'
          : 'UNAVAILABLE';
    return {
      snapshot,
      freshness,
      ageMs,
      // An expired table is deliberately NOT handed out: comparing against
      // rates nobody stands behind is worse than saying "not comparable".
      table: freshness === 'UNAVAILABLE' ? null : snapshot,
    };
  }

  /**
   * Fetches, validates and atomically replaces the snapshot.
   *
   * Returns null when there is no provider configured or the refresh failed —
   * in both cases the existing snapshot is left exactly as it was.
   */
  async refresh(): Promise<FxSnapshot | null> {
    if (!this.provider.configured) {
      this.logger.debug?.(
        'No exchange-rate provider configured; skipping refresh',
      );
      return null;
    }
    try {
      const fetched = await this.provider.fetchLatest();
      const snapshot: FxSnapshot = {
        baseCurrency: fetched.baseCurrency,
        rates: fetched.rates,
        fetchedAt: new Date().toISOString(),
        providerTimestamp: fetched.providerTimestamp,
        snapshotVersion: versionOf(fetched.baseCurrency, fetched.rates),
      };
      // One SET of one document: readers see old or new, never a mixture.
      await this.redis.client.set(FX_SNAPSHOT_KEY, JSON.stringify(snapshot));
      this.lastSuccessAt = snapshot.fetchedAt;
      this.logger.log(
        `FX snapshot updated: ${Object.keys(snapshot.rates).length} rates, ` +
          `version ${snapshot.snapshotVersion.slice(0, 12)}`,
      );
      return snapshot;
    } catch (error) {
      // The previous snapshot stays. A provider outage costs freshness, never
      // the ability to rank or to show a job.
      this.lastFailureAt = new Date().toISOString();
      this.lastFailureReason = (error as Error).message;
      this.logger.warn(
        `FX refresh failed, keeping the last known good snapshot: ` +
          `${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Refreshes only if nothing usable is cached, and only once across
   * concurrent callers.
   *
   * Ten simultaneous Job Match requests on a cold cache must produce one
   * provider call, not ten. A Redis `SET NX PX` is the lock; whoever loses the
   * race simply proceeds without rates rather than waiting on the winner —
   * salary is one soft signal and no request should block on it.
   */
  async ensureSnapshot(): Promise<FxSnapshotView> {
    const view = await this.current();
    if (view.freshness !== 'UNAVAILABLE') return view;
    if (!this.provider.configured) return view;

    let acquired = false;
    try {
      acquired =
        (await this.redis.client.set(
          FX_REFRESH_LOCK_KEY,
          '1',
          'PX',
          60_000,
          'NX',
        )) === 'OK';
    } catch {
      return view;
    }
    if (!acquired) return view;

    try {
      const snapshot = await this.refresh();
      if (!snapshot) return view;
      return {
        snapshot,
        freshness: 'FRESH',
        ageMs: 0,
        table: snapshot,
      };
    } finally {
      await this.redis.client.del(FX_REFRESH_LOCK_KEY).catch(() => undefined);
    }
  }

  /** Operational state, safe to log or expose to an internal health view. */
  status() {
    return {
      configured: this.provider.configured,
      refreshIntervalMs: this.config.get<number>(
        'exchangeRates.refreshIntervalMs',
        30 * 60_000,
      ),
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastFailureReason: this.lastFailureReason,
    };
  }
}

/**
 * Content hash of a rate table.
 *
 * Deliberately content-based rather than time-based: a refresh that returns
 * the same rates produces the same version, so nothing downstream treats an
 * unchanged table as a change. That is what keeps a 30-minute refresh cycle
 * from looking like churn to anything that records which rates it used.
 */
export function versionOf(
  baseCurrency: string,
  rates: Record<string, number>,
): string {
  const canonical = Object.keys(rates)
    .sort()
    .map((code) => `${code}:${rates[code]}`)
    .join(',');
  return createHash('sha256')
    .update(`${baseCurrency}|${canonical}`)
    .digest('hex');
}
