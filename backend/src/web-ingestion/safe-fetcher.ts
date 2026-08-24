import { Injectable, Logger, Optional } from '@nestjs/common';
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import type { LookupAddress } from 'node:dns';
import { LinkFailureCode } from '../generated/prisma/enums';
import { WebIngestionError } from './web-ingestion.errors';
import { classifyAddress } from './ip-guard';
import { assertFetchableUrl } from './url-policy';
import {
  SUPPORTED_CONTENT_TYPES,
  WEB_INGESTION_LIMITS,
} from './web-ingestion.limits';

/**
 * The ONLY place this service opens a socket to a user-supplied destination.
 *
 * Everything about it exists to make one guarantee: **the bytes come from a
 * public host, or they do not come at all.** Three mechanisms hold it up, and
 * each covers a hole the others leave.
 *
 * 1. **Syntactic policy, on every hop.** `assertFetchableUrl` runs on the
 *    submitted URL and again on each redirect target, so a public site cannot
 *    bounce us into `file://`, port 6379, or `http://metadata.internal/`.
 *
 * 2. **A pinned, validated address.** DNS is resolved HERE, every returned
 *    address is classified (see ip-guard), and the socket is told to connect to
 *    a specific vetted address via the `lookup` hook. This is what closes DNS
 *    REBINDING: with a naive "resolve, check, then fetch by hostname" the name
 *    is resolved twice and an attacker-controlled resolver can answer 93.x the
 *    first time and 169.254.169.254 the second. Here the address that was
 *    checked *is* the address connected to — there is no second resolution to
 *    poison. Note the request still carries the real Host header and SNI, so
 *    virtual hosting and TLS keep working.
 *
 * 3. **Hard bounds.** Connect timeout, request timeout, response byte cap and
 *    redirect count are enforced by this class, not by the remote server's
 *    good behaviour.
 *
 * Redirects are followed MANUALLY (never by an HTTP client's automatic
 * following) precisely because automatic following would skip 1 and 2 on every
 * hop but the first.
 */
/**
 * The socket-level half of a fetch, separated from the policy half.
 *
 * The redirect loop — the part that must re-apply the URL policy and re-resolve
 * the address on EVERY hop — is the piece most likely to be got wrong, and the
 * piece a test cannot reach if it can only talk to real servers on real ports.
 * Splitting the transport out lets that loop be tested exactly: "a public site
 * redirects to an internal host" is a two-line fake here and an unreproducible
 * scenario otherwise.
 */
export interface HttpTransport {
  send(
    url: URL,
    pinned: LookupAddress,
    options: { deadline: number; maxBytes: number; userAgent?: string },
  ): Promise<RawResponse>;
}

@Injectable()
export class SafeHttpFetcher {
  private readonly logger = new Logger(SafeHttpFetcher.name);
  private readonly transport: HttpTransport;

  /**
   * The transport is a TEST seam; production always uses Node's.
   *
   * `@Optional()` is required, not decorative: without it Nest tries to
   * resolve `HttpTransport` from the container, and an interface has no
   * runtime token — the whole application then fails to boot.
   */
  constructor(@Optional() transport?: HttpTransport) {
    this.transport = transport ?? {
      send: (...args) => this.requestOnce(...args),
    };
  }

  /**
   * Fetches one URL as text, following redirects safely.
   *
   * @param deadline absolute epoch-ms after which the whole link budget is
   *   spent. Passed in (rather than started here) so a multi-page link cannot
   *   get a fresh timeout for every page it discovers.
   */
  async fetchText(
    rawUrl: string,
    options: {
      deadline: number;
      maxBytes?: number;
      /** Content types this particular call accepts. Defaults to web pages. */
      allowedContentTypes?: ReadonlySet<string>;
      /**
       * An extra gate, applied to the first URL and to EVERY redirect target.
       *
       * The syntactic policy and the address check answer "is this a public
       * host"; some callers additionally need "is this one of the specific
       * hosts I was configured to read". External job ingestion does: it
       * fetches on a schedule against operator-approved company careers sites,
       * and a careers page that redirects to another domain must fail rather
       * than quietly widen what the scheduler reaches.
       *
       * It lives inside the redirect loop for the same reason the rest of the
       * policy does — a check applied only to the URL the caller passed in is
       * a check the first response can redirect around.
       */
      allowHost?: (url: URL) => boolean;
      /** Overrides the default candidate-link agent. See userAgent below. */
      userAgent?: string;
    },
  ): Promise<FetchedResource> {
    const maxBytes = options.maxBytes ?? WEB_INGESTION_LIMITS.maxResponseBytes;
    const allowed = options.allowedContentTypes ?? SUPPORTED_CONTENT_TYPES;

    let current = new URL(rawUrl);
    assertFetchableUrl(current);
    this.assertAllowedHost(current, options.allowHost);

    for (let hop = 0; hop <= WEB_INGESTION_LIMITS.maxRedirects; hop += 1) {
      this.assertDeadline(options.deadline);

      const address = await this.resolvePublicAddress(current.hostname);
      const response = await this.transport.send(current, address, {
        deadline: options.deadline,
        maxBytes,
        userAgent: options.userAgent,
      });

      if (!isRedirect(response.status)) {
        return this.finishResponse(current, response, allowed, maxBytes);
      }

      const location = response.headers.location;
      if (!location) {
        throw new WebIngestionError(
          LinkFailureCode.UPSTREAM_ERROR,
          `Redirect ${response.status} without a Location header`,
        );
      }

      // Resolve relative Locations against the CURRENT url, then re-apply the
      // full policy. This is the hop that a naive fetcher gets wrong.
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new WebIngestionError(
          LinkFailureCode.INVALID_URL,
          'Redirect target could not be parsed',
        );
      }
      assertFetchableUrl(next);
      this.assertAllowedHost(next, options.allowHost);
      current = next;
    }

    throw new WebIngestionError(
      LinkFailureCode.TOO_MANY_REDIRECTS,
      `Exceeded ${WEB_INGESTION_LIMITS.maxRedirects} redirects`,
    );
  }

  /**
   * Resolves a hostname and returns ONE address that is safe to connect to.
   *
   * Every address the resolver returns must be public. A host that answers
   * with a mix of public and private addresses is refused outright rather than
   * "filtered down to the public ones": that answer shape is either a
   * misconfiguration or an attack, and neither deserves a connection.
   */
  private async resolvePublicAddress(hostname: string): Promise<LookupAddress> {
    let addresses: LookupAddress[];
    try {
      addresses = await dns.promises.lookup(hostname, {
        all: true,
        verbatim: true,
      });
    } catch (error) {
      throw new WebIngestionError(
        LinkFailureCode.INVALID_URL,
        `DNS lookup failed for ${hostname}: ${(error as Error).message}`,
      );
    }

    if (addresses.length === 0) {
      throw new WebIngestionError(
        LinkFailureCode.INVALID_URL,
        `DNS returned no addresses for ${hostname}`,
      );
    }

    for (const entry of addresses) {
      const verdict = classifyAddress(entry.address);
      if (!verdict.allowed) {
        this.logger.warn(
          `Blocked candidate link host ${hostname}: resolves to a ` +
            `${verdict.reason} address`,
        );
        throw new WebIngestionError(
          LinkFailureCode.PRIVATE_NETWORK_URL,
          `${hostname} resolves to a ${verdict.reason} address`,
        );
      }
    }
    return addresses[0];
  }

  /** One request, to one pinned address. No redirect following. */
  private requestOnce(
    url: URL,
    pinned: LookupAddress,
    options: { deadline: number; maxBytes: number; userAgent?: string },
  ): Promise<RawResponse> {
    const client = url.protocol === 'https:' ? https : http;
    const remaining = Math.max(1, options.deadline - Date.now());
    const timeoutMs = Math.min(
      WEB_INGESTION_LIMITS.requestTimeoutMs,
      remaining,
    );

    return new Promise<RawResponse>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        fn();
      };

      const request = client.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: {
            // Honest about who is asking. A caller with a different purpose
            // says so, so a site operator reading their logs can tell a
            // candidate-submitted link fetch from scheduled job ingestion —
            // and can address a robots rule at one without the other.
            'user-agent': options.userAgent ?? WEB_INGESTION_LIMITS.userAgent,
            accept:
              'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
            'accept-language': 'en,ko;q=0.8,ru;q=0.8,uz;q=0.8',
            // No cookies, no credentials, no referrer. Nothing about this
            // service's identity or any user's session travels outbound.
            'accept-encoding': 'identity',
          },
          timeout: WEB_INGESTION_LIMITS.connectTimeoutMs,
          // THE pin. Hands the socket the address ip-guard already approved,
          // so no second DNS resolution can substitute a private one.
          lookup: ((
            _hostname: string,
            lookupOptions: dns.LookupOneOptions | dns.LookupAllOptions,
            callback: (
              error: NodeJS.ErrnoException | null,
              address: string | LookupAddress[],
              family?: number,
            ) => void,
          ) => {
            if ((lookupOptions as dns.LookupAllOptions).all) {
              callback(null, [pinned]);
              return;
            }
            callback(null, pinned.address, pinned.family);
          }) as unknown as typeof dns.lookup,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const headers = response.headers;

          // A declared oversize body is refused before a single chunk of it is
          // buffered.
          const declared = Number(headers['content-length'] ?? '');
          if (Number.isFinite(declared) && declared > options.maxBytes) {
            response.destroy();
            finish(() =>
              reject(
                new WebIngestionError(
                  LinkFailureCode.CONTENT_TOO_LARGE,
                  `Content-Length ${declared} exceeds ${options.maxBytes} bytes`,
                ),
              ),
            );
            return;
          }

          if (isRedirect(status)) {
            // The body of a redirect is never useful; drop it immediately
            // rather than paying to download it.
            response.destroy();
            finish(() => resolve({ status, headers, body: Buffer.alloc(0) }));
            return;
          }

          const chunks: Buffer[] = [];
          let total = 0;
          response.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > options.maxBytes) {
              response.destroy();
              finish(() =>
                reject(
                  new WebIngestionError(
                    LinkFailureCode.CONTENT_TOO_LARGE,
                    `Response exceeded ${options.maxBytes} bytes`,
                  ),
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () =>
            finish(() =>
              resolve({ status, headers, body: Buffer.concat(chunks) }),
            ),
          );
          response.on('error', (error) =>
            finish(() =>
              reject(
                new WebIngestionError(
                  LinkFailureCode.UPSTREAM_ERROR,
                  `Response stream failed: ${error.message}`,
                ),
              ),
            ),
          );
        },
      );

      // Socket-level inactivity (including a stalled connect).
      request.on('timeout', () => {
        request.destroy();
        finish(() =>
          reject(
            new WebIngestionError(
              LinkFailureCode.FETCH_TIMEOUT,
              'Connection timed out',
            ),
          ),
        );
      });

      request.on('error', (error) =>
        finish(() =>
          reject(
            error instanceof WebIngestionError
              ? error
              : new WebIngestionError(
                  LinkFailureCode.UPSTREAM_ERROR,
                  `Request failed: ${error.message}`,
                ),
          ),
        ),
      );

      // A server that dribbles one byte per second keeps the socket "active"
      // forever, so inactivity alone is not enough: this is the wall clock.
      const hardTimer = setTimeout(() => {
        request.destroy();
        if (!settled) {
          settled = true;
          reject(
            new WebIngestionError(
              LinkFailureCode.FETCH_TIMEOUT,
              `Request exceeded ${timeoutMs}ms`,
            ),
          );
        }
      }, timeoutMs);

      request.end();
    });
  }

  /** Status and content-type policy, then decoding. */
  private finishResponse(
    url: URL,
    response: RawResponse,
    allowedContentTypes: ReadonlySet<string>,
    maxBytes: number,
  ): FetchedResource {
    if (response.status >= 500 || response.status === 429) {
      throw new WebIngestionError(
        LinkFailureCode.UPSTREAM_ERROR,
        `Upstream responded ${response.status}`,
      );
    }
    if (response.status >= 400) {
      // 401/403/404/410/451 and friends: the site is refusing or has nothing
      // there. Both are "not publicly accessible" and neither is worked around.
      throw new WebIngestionError(
        LinkFailureCode.ACCESS_DENIED,
        `Upstream responded ${response.status}`,
      );
    }
    if (response.status < 200) {
      throw new WebIngestionError(
        LinkFailureCode.UPSTREAM_ERROR,
        `Unexpected status ${response.status}`,
      );
    }

    const rawContentType = String(response.headers['content-type'] ?? '');
    const mediaType = rawContentType.split(';')[0].trim().toLowerCase();
    if (mediaType && !allowedContentTypes.has(mediaType)) {
      throw new WebIngestionError(
        LinkFailureCode.UNSUPPORTED_CONTENT_TYPE,
        `Content type ${mediaType} is not supported`,
      );
    }
    if (response.body.length > maxBytes) {
      throw new WebIngestionError(
        LinkFailureCode.CONTENT_TOO_LARGE,
        `Response exceeded ${maxBytes} bytes`,
      );
    }

    return {
      url: url.toString(),
      status: response.status,
      mediaType: mediaType || 'text/html',
      body: decodeBody(response.body, rawContentType),
      byteLength: response.body.length,
    };
  }

  /**
   * The caller's allowlist, as a hard failure rather than a filter.
   *
   * ACCESS_DENIED and not a private-network code: the target may be perfectly
   * public and perfectly reachable — it is simply not one this caller was
   * configured to read, which is a policy decision, not a security verdict.
   *
   * The message names the PATH as well as the host, because a caller may
   * allow a host and only some of its paths — and a message saying only
   * "host not allowed" about a host that plainly is allowed sends whoever
   * reads it looking in the wrong place. That happened on the first live
   * company-careers run: `vercel.com/sitemap.xml` 301s to
   * `vercel.com/crawled-sitemap.xml`, same host, undeclared path.
   */
  private assertAllowedHost(
    url: URL,
    allowHost: ((url: URL) => boolean) | undefined,
  ): void {
    if (!allowHost || allowHost(url)) return;
    throw new WebIngestionError(
      LinkFailureCode.ACCESS_DENIED,
      `${url.hostname}${url.pathname} is not on this caller's allowlist`,
    );
  }

  private assertDeadline(deadline: number): void {
    if (Date.now() >= deadline) {
      throw new WebIngestionError(
        LinkFailureCode.FETCH_TIMEOUT,
        'Link processing budget exhausted',
      );
    }
  }
}

export interface FetchedResource {
  /** The URL the content actually came from, after redirects. */
  url: string;
  status: number;
  mediaType: string;
  body: string;
  byteLength: number;
}

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * Decodes to text using the declared charset, falling back to UTF-8.
 *
 * Only encodings Node implements natively are honoured; an exotic declared
 * charset decodes as UTF-8 rather than pulling in an encoding library, which
 * at worst mangles some accents in evidence a human will read next to the
 * original link.
 */
function decodeBody(body: Buffer, contentType: string): string {
  const declared = /charset=\s*"?([\w-]+)"?/i.exec(contentType)?.[1];
  const sniffed =
    declared ??
    /<meta[^>]+charset=\s*["']?([\w-]+)/i.exec(
      body.subarray(0, 2048).toString('latin1'),
    )?.[1];

  const encoding = (sniffed ?? 'utf-8').toLowerCase();
  if (
    encoding === 'iso-8859-1' ||
    encoding === 'latin1' ||
    encoding === 'windows-1252'
  ) {
    return body.toString('latin1');
  }
  if (encoding === 'ascii' || encoding === 'us-ascii') {
    return body.toString('ascii');
  }
  return body.toString('utf8');
}
