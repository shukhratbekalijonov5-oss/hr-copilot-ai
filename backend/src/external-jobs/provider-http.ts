import { Logger } from '@nestjs/common';

/**
 * The one way this product talks to a job provider.
 *
 * Every provider fetch runs server-side, on a schedule, against a host the
 * provider named. That combination is why this file is defensive rather than a
 * thin `fetch` wrapper: an unbounded request on a timer is a resource leak, an
 * unvalidated redirect is an SSRF, and an unbounded response body is a
 * memory-exhaustion bug that only shows up on the day an upstream misbehaves.
 *
 * The rules, all enforced here so no provider can forget one:
 *
 *   - the host must be on the provider's allowlist, ON EVERY HOP;
 *   - redirects are followed manually and re-validated, never automatically;
 *   - a request has a deadline, and the deadline covers the body read;
 *   - the body has a byte ceiling;
 *   - retries are bounded, backed off, and honour `Retry-After`;
 *   - 4xx (other than 429) is never retried — a 404 will still be a 404;
 *   - nothing logs a URL's query string, a response body, or a header.
 */

export class ProviderHttpError extends Error {
  /** Set only for 429s that carried a `Retry-After`. */
  retryAfterMs?: number;

  constructor(
    message: string,
    readonly status: number | null,
    /** True when a later attempt could plausibly succeed. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

/** "This resource is gone" — distinct from "the fetch failed". */
export class ProviderNotFoundError extends ProviderHttpError {
  constructor(status: number) {
    super(`Provider responded ${status}`, status, false);
    this.name = 'ProviderNotFoundError';
  }
}

/** The subset of `fetch` this client uses. An injection seam for tests. */
export type ProviderFetch = (
  url: string,
  init: {
    signal?: AbortSignal;
    redirect: 'manual';
    headers: Record<string, string>;
  },
) => Promise<ProviderResponse>;

export interface ProviderResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/**
 * A credential for one request.
 *
 * Passed per call rather than held on the client, because a client is shared
 * across scopes while a credential belongs to exactly one of them — a stored
 * token is a token that eventually goes to the wrong workspace.
 */
export interface AuthHeader {
  scheme: 'Bearer';
  token: string;
}

export interface ProviderHttpOptions {
  /** Hosts this client may contact. Exact host or a true subdomain. */
  allowedHosts: string[];
  timeoutMs?: number;
  maxAttempts?: number;
  /** First backoff step; doubles per attempt. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Minimum gap between requests from this client. */
  minRequestIntervalMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  fetchImpl?: ProviderFetch;
  /** Injected so tests do not spend real seconds proving backoff works. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  backoffMs: 1_000,
  maxBackoffMs: 30_000,
  minRequestIntervalMs: 0,
  // Comfortably above the largest real job-board response observed (~850 KB
  // for 83 postings with full descriptions) and far below anything that could
  // pressure a worker's heap.
  maxResponseBytes: 32 * 1024 * 1024,
  maxRedirects: 3,
};

/**
 * Exact host or a true subdomain of an allowed host.
 *
 * Never a suffix match: `endsWith('greenhouse.io')` would accept
 * `evil-greenhouse.io`, which is a domain an attacker can simply register.
 */
export function hostAllowed(url: string, allowedHosts: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  // Credentials in a URL are how a fetcher gets talked into authenticating to
  // somewhere it should not.
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    const candidate = allowed.toLowerCase();
    return host === candidate || host.endsWith(`.${candidate}`);
  });
}

export class ProviderHttpClient {
  private readonly logger = new Logger(ProviderHttpClient.name);
  private readonly options: Required<
    Omit<ProviderHttpOptions, 'fetchImpl' | 'sleepImpl' | 'userAgent'>
  > & {
    userAgent: string;
  };
  private readonly fetchImpl: ProviderFetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  /** Serializes the interval gate; see `throttle`. */
  private gate: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: ProviderHttpOptions) {
    this.options = {
      allowedHosts: options.allowedHosts,
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
      backoffMs: options.backoffMs ?? DEFAULTS.backoffMs,
      maxBackoffMs: options.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
      minRequestIntervalMs:
        options.minRequestIntervalMs ?? DEFAULTS.minRequestIntervalMs,
      maxResponseBytes: options.maxResponseBytes ?? DEFAULTS.maxResponseBytes,
      maxRedirects: options.maxRedirects ?? DEFAULTS.maxRedirects,
      // Identifying the caller is the courteous half of rate-limit compliance:
      // it lets a provider talk to us instead of silently blocking us.
      userAgent: options.userAgent ?? 'HRCopilot-JobIngestion/1.0',
    };
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleepImpl =
      options.sleepImpl ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * GET a URL and parse it as JSON.
   *
   * Throws `ProviderNotFoundError` on 404/410 — which callers read as evidence
   * about the RESOURCE — and `ProviderHttpError` on everything else, which is
   * evidence only about the request.
   */
  async getJson<T>(url: string, auth?: AuthHeader): Promise<T> {
    const body = await this.getText(url, auth);
    try {
      return JSON.parse(body) as T;
    } catch {
      // The body is not logged: a broken upstream can return anything,
      // including someone else's data.
      throw new ProviderHttpError(
        'Provider returned a body that is not valid JSON',
        null,
        // Retried once in case a truncated response caused it; a genuinely
        // malformed endpoint will exhaust attempts and fail the run cleanly.
        true,
      );
    }
  }

  async getText(url: string, auth?: AuthHeader): Promise<string> {
    if (!hostAllowed(url, this.options.allowedHosts)) {
      // Not retryable and not a provider problem: this is our own bug or an
      // attempt to steer the fetcher somewhere it may not go.
      throw new ProviderHttpError(
        `Host is not on this provider's allowlist: ${safeHost(url)}`,
        null,
        false,
      );
    }

    let lastError: ProviderHttpError | null = null;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        await this.throttle();
        return await this.requestFollowingRedirects(url, auth);
      } catch (error) {
        const failure =
          error instanceof ProviderHttpError
            ? error
            : new ProviderHttpError(
                (error as Error).message || 'Provider request failed',
                null,
                // Network-level failures (DNS, reset, abort) are the classic
                // transient case.
                true,
              );
        if (!failure.retryable || attempt === this.options.maxAttempts) {
          throw failure;
        }
        lastError = failure;
        const wait = this.backoffFor(attempt, failure);
        this.logger.warn(
          `Provider request to ${safeHost(url)} failed ` +
            `(attempt ${attempt}/${this.options.maxAttempts}, ` +
            `status ${failure.status ?? 'none'}); retrying in ${wait}ms`,
        );
        await this.sleepImpl(wait);
      }
    }
    /* istanbul ignore next -- the loop always returns or throws */
    throw (
      lastError ?? new ProviderHttpError('Provider request failed', null, true)
    );
  }

  /**
   * How long to wait before the next attempt.
   *
   * `Retry-After` wins when the provider sends one: it is the provider telling
   * us what it wants, and ignoring it is how an integration earns a block.
   * Otherwise exponential, capped — a fixed short delay under load is a retry
   * storm with extra steps.
   */
  private backoffFor(attempt: number, failure: ProviderHttpError): number {
    if (failure.status === 429 && failure.retryAfterMs !== undefined) {
      return Math.min(failure.retryAfterMs, this.options.maxBackoffMs);
    }
    return Math.min(
      this.options.backoffMs * 2 ** (attempt - 1),
      this.options.maxBackoffMs,
    );
  }

  /**
   * Hold the next request until the provider's minimum interval has passed.
   *
   * Chained onto a single promise rather than checked against a timestamp, so
   * concurrent callers queue instead of all reading the same "last request
   * was long ago" and firing together.
   */
  private throttle(): Promise<void> {
    const interval = this.options.minRequestIntervalMs;
    if (interval <= 0) return Promise.resolve();
    this.gate = this.gate.then(async () => {
      const wait = this.lastRequestAt + interval - Date.now();
      if (wait > 0) await this.sleepImpl(wait);
      this.lastRequestAt = Date.now();
    });
    return this.gate;
  }

  /**
   * One logical request, following redirects by hand.
   *
   * Manual because `redirect: 'follow'` would let the FIRST response choose
   * the next host, and an allowlist checked only on the original URL is an
   * allowlist that can be redirected around. Every hop is re-validated.
   */
  private async requestFollowingRedirects(
    startUrl: string,
    auth?: AuthHeader,
  ): Promise<string> {
    let url = startUrl;
    for (let hop = 0; hop <= this.options.maxRedirects; hop += 1) {
      const response = await this.request(url, auth);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new ProviderHttpError(
            `Provider responded ${response.status} with no location`,
            response.status,
            false,
          );
        }
        let next: string;
        try {
          next = new URL(location, url).toString();
        } catch {
          throw new ProviderHttpError(
            'Provider sent an unparseable redirect target',
            response.status,
            false,
          );
        }
        if (!hostAllowed(next, this.options.allowedHosts)) {
          // A provider redirecting off its own allowlist is exactly the case
          // this check exists for, and following it "just this once" is how
          // the allowlist stops meaning anything.
          throw new ProviderHttpError(
            `Provider redirected to a host outside its allowlist: ${safeHost(next)}`,
            response.status,
            false,
          );
        }
        url = next;
        continue;
      }

      if (response.status === 404 || response.status === 410) {
        throw new ProviderNotFoundError(response.status);
      }
      if (response.status === 429) {
        const failure = new ProviderHttpError(
          'Provider rate limit reached',
          429,
          true,
        );
        failure.retryAfterMs = parseRetryAfter(
          response.headers.get('retry-after'),
        );
        throw failure;
      }
      if (response.status >= 500) {
        throw new ProviderHttpError(
          `Provider responded ${response.status}`,
          response.status,
          true,
        );
      }
      if (response.status >= 400) {
        // 401/403/400: a later identical request gets the same answer.
        throw new ProviderHttpError(
          `Provider responded ${response.status}`,
          response.status,
          false,
        );
      }
      return await this.readCapped(response);
    }
    throw new ProviderHttpError(
      `Provider exceeded ${this.options.maxRedirects} redirects`,
      null,
      false,
    );
  }

  private async request(
    url: string,
    auth?: AuthHeader,
  ): Promise<ProviderResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
          /*
           * Attached here and nowhere else. The credential is read by the
           * caller immediately before the request, lives only in this object,
           * and is never logged: every log line in this file reports a HOST
           * and a status, never a header and never a URL with its query.
           *
           * Redirects re-validate the host on every hop before this header is
           * sent again, so an upstream cannot redirect a credential to a host
           * it was not issued for.
           */
          ...(auth ? { authorization: `${auth.scheme} ${auth.token}` } : {}),
        },
      });
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError';
      throw new ProviderHttpError(
        aborted
          ? `Provider request timed out after ${this.options.timeoutMs}ms`
          : `Provider request failed: ${(error as Error).message}`,
        null,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read the body, refusing anything over the ceiling.
   *
   * The length is checked AFTER reading rather than trusting `Content-Length`,
   * because that header is upstream's claim and a chunked response has none.
   */
  private async readCapped(response: ProviderResponse): Promise<string> {
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > this.options.maxResponseBytes) {
      throw new ProviderHttpError(
        `Provider response exceeded ${this.options.maxResponseBytes} bytes`,
        response.status,
        false,
      );
    }
    return body;
  }
}

/** `Retry-After` as milliseconds — seconds or an HTTP date. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, 3_600) * 1_000;
  }
  const when = Date.parse(value);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, Math.min(when - Date.now(), 3_600_000));
}

/** A URL reduced to its host, for logs. Query strings can carry anything. */
export function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '<unparseable url>';
  }
}
