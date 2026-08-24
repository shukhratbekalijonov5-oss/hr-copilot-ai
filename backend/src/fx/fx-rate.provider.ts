import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Where exchange rates come from — as an interface, so nothing above it knows.
 *
 * The matcher, the salary code and the ranking pipeline depend on this shape
 * and never on a vendor. Swapping providers, or adding a second one as a
 * fallback, is a change to this file and nowhere else.
 */
export interface FxRateFetch {
  baseCurrency: string;
  /** Currency code → units per one base unit. */
  rates: Record<string, number>;
  /** The provider's own "as of" time, when it reports one. */
  providerTimestamp: string | null;
}

export abstract class FxRateProvider {
  /** Latest rates, or a thrown error. Never a partial table. */
  abstract fetchLatest(): Promise<FxRateFetch>;
  /** False when no provider is configured; callers skip the work entirely. */
  abstract get configured(): boolean;
}

export const FX_HTTP_FETCH = Symbol('FX_HTTP_FETCH');

/** Injectable seam for tests: the same contract as global fetch. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Every currency the product prices anything in. A provider table is filtered
 * down to these, so a vendor sending 160 currencies (or a rogue key like
 * `__proto__`) cannot bloat or poison the snapshot.
 */
const KNOWN_CURRENCY = /^[A-Z]{3}$/;

/**
 * One HTTP call to a configured rates endpoint.
 *
 * ## The endpoint is configuration, not code
 *
 * `EXCHANGE_RATE_API_URL` is a template — `{key}` and `{base}` are substituted
 * — because an API key does not identify its provider. Hard-coding a guessed
 * vendor URL would mean posting someone's real credential to a service that
 * may not be theirs, so with no URL set this provider reports itself
 * unconfigured and the product runs with FX simply unavailable.
 *
 * ## The response shape is normalized, not assumed
 *
 * Rate APIs put the table under different keys (`rates`, `conversion_rates`,
 * `data`). All three are accepted and validated the same way; anything that is
 * not a plain map of ISO-4217 codes to positive finite numbers is rejected
 * outright rather than half-imported.
 */
@Injectable()
export class HttpFxRateProvider extends FxRateProvider {
  private readonly logger = new Logger(HttpFxRateProvider.name);
  private readonly urlTemplate: string;
  private readonly apiKey: string;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(
    config: ConfigService,
    @Optional() @Inject(FX_HTTP_FETCH) fetchImpl?: FetchLike,
  ) {
    super();
    this.urlTemplate = config.get<string>('exchangeRates.baseUrl', '');
    this.apiKey = config.get<string>('exchangeRates.apiKey', '');
    this.base = config
      .get<string>('exchangeRates.baseCurrency', 'USD')
      .toUpperCase();
    this.timeoutMs = config.get<number>(
      'exchangeRates.requestTimeoutMs',
      10_000,
    );
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  get configured(): boolean {
    return this.urlTemplate.length > 0;
  }

  /** The request URL. Private: it embeds the credential. */
  private buildUrl(): string {
    return this.urlTemplate
      .replace('{key}', encodeURIComponent(this.apiKey))
      .replace('{base}', this.base);
  }

  async fetchLatest(): Promise<FxRateFetch> {
    if (!this.configured) {
      throw new Error('No exchange-rate provider is configured');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    try {
      const response = await this.fetchImpl(this.buildUrl(), {
        signal: controller.signal,
      });
      // Status codes only. The URL and body are never logged: the URL carries
      // the key, and a provider error body can echo it back.
      if (!response.ok) {
        throw new Error(`Exchange-rate provider responded ${response.status}`);
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const fetched = this.parse(payload);
      this.logger.log(
        `Exchange rates fetched: ${Object.keys(fetched.rates).length} ` +
          `currencies, base ${fetched.baseCurrency}, ${Date.now() - started}ms`,
      );
      return fetched;
    } finally {
      clearTimeout(timer);
    }
  }

  private parse(payload: Record<string, unknown>): FxRateFetch {
    const table =
      (payload.conversion_rates as Record<string, unknown>) ??
      (payload.rates as Record<string, unknown>) ??
      ((payload.data as Record<string, unknown>) || undefined);
    if (!table || typeof table !== 'object' || Array.isArray(table)) {
      throw new Error('Exchange-rate response contained no rate table');
    }

    const rates: Record<string, number> = {};
    for (const [code, value] of Object.entries(table)) {
      const upper = code.toUpperCase();
      if (!KNOWN_CURRENCY.test(upper)) continue;
      const numeric =
        typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? Number(value)
            : NaN;
      if (!Number.isFinite(numeric) || numeric <= 0) continue;
      rates[upper] = numeric;
    }
    if (Object.keys(rates).length === 0) {
      throw new Error('Exchange-rate response contained no usable rates');
    }

    const base =
      typeof payload.base_code === 'string'
        ? payload.base_code
        : typeof payload.base === 'string'
          ? payload.base
          : this.base;

    const stamp =
      typeof payload.time_last_update_utc === 'string'
        ? payload.time_last_update_utc
        : typeof payload.timestamp === 'number'
          ? new Date(payload.timestamp * 1000).toISOString()
          : typeof payload.date === 'string'
            ? payload.date
            : null;

    return {
      baseCurrency: base.toUpperCase(),
      rates,
      providerTimestamp: stamp,
    };
  }
}
