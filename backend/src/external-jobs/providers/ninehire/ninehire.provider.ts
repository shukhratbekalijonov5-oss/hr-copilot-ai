import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalJobProvider } from '../../external-job.provider';
import {
  ProviderHttpClient,
  ProviderNotFoundError,
  type AuthHeader,
  type ProviderFetch,
} from '../../provider-http';
import {
  parseNinehireSources,
  readSecret,
  type NinehireSource,
} from './ninehire.sources';
import { ninehireIngestable, normalizeNinehireJob } from './ninehire.normalize';
import type {
  ExternalProviderDescriptor,
  NormalizedExternalJobInput,
  ProviderFetchPage,
} from '../../external-job.contract';
import type { NinehireJob, NinehireJobList } from './ninehire.types';

/**
 * Ninehire, read through its official authenticated API.
 *
 *   GET https://api.ninehire.com/api/v1/jobs?page=&countPerPage=
 *   GET https://api.ninehire.com/api/v1/jobs/{jobId}
 *   Authorization: Bearer {API_KEY}
 *
 * ## This provider is not like the other three
 *
 * Greenhouse, Lever and Ashby expose PUBLIC boards: anyone may read them and
 * the only question is which to read. Ninehire's API is authenticated per
 * WORKSPACE and gated behind a paid plan, so reading one is only legitimate
 * when the operator running this deployment holds that workspace's key.
 *
 * Everything follows from that. There is no discovery, no enumeration, no
 * public fallback and no scraping of career.ninehire.com. A workspace with no
 * configured credential is not visible to this code at all — `configured`
 * returns false and no request is ever built.
 *
 * ## The credential
 *
 * Read from configuration at REQUEST time, attached to one Authorization
 * header, and never held on the client, put in a queue payload, written to the
 * database or included in a log line. The official documentation asks the same
 * thing ("API 키는 소스코드에 배포되거나 외부에 노출되지 않도록 주의"), and the
 * per-request `AuthHeader` shape exists so a token cannot outlive the call or
 * drift to a different workspace's request.
 *
 * ## Rate limit — 60 requests per minute, PER KEY, across all endpoints
 *
 * Documented explicitly, and it is a combined budget: list calls and detail
 * calls come out of the same 60. There are no rate-limit headers and no usage
 * endpoint, so the only safe strategy is to stay under it by construction —
 * one request per second per key, enforced by a SEPARATE http client per
 * source, because the limit belongs to the key rather than to the provider.
 */
@Injectable()
export class NinehireProvider extends ExternalJobProvider {
  private readonly logger = new Logger(NinehireProvider.name);
  private readonly sources: NinehireSource[];
  /** One client per key: the documented rate limit is per credential. */
  private readonly clients = new Map<string, ProviderHttpClient>();
  private readonly pageSize: number;
  private readonly detailBudget: number;

  /**
   * The API host, and only the API host.
   *
   * Apply links live on `career.ninehire.com`; they are STORED and shown to
   * candidates and never fetched. Scraping that host is exactly what the
   * official API exists to make unnecessary.
   */
  static readonly API_HOST = 'api.ninehire.com';
  static readonly API_BASE = `https://${NinehireProvider.API_HOST}/api/v1/jobs`;

  readonly descriptor: ExternalProviderDescriptor = {
    provider: 'NINEHIRE',
    accessMethod: 'OFFICIAL_API',
    allowedHosts: [NinehireProvider.API_HOST],
    maxConcurrency: 1,
    // 60/minute per key, list and detail combined. One per second, with no
    // burst, keeps every workspace inside it without needing headers we are
    // not given.
    minRequestIntervalMs: 1_000,
    stalenessMs: 14 * 24 * 60 * 60_000,
    absenceImpliesClosed: true,
  };

  constructor(
    private readonly config: ConfigService,
    private readonly fetchImpl?: ProviderFetch,
    /**
     * Injectable clock, so the one-second rate gate is asserted rather than
     * waited for. Real runs use the default; a test that genuinely slept
     * through a hundred detail calls would take a hundred seconds and get
     * deleted by the next person who ran it.
     */
    private readonly sleepImpl?: (ms: number) => Promise<void>,
  ) {
    super();
    this.sources = parseNinehireSources(
      config.get<string>('externalJobs.ninehireSources', ''),
      config,
      this.logger,
    );
    this.pageSize = clampPageSize(
      config.get<number>('externalJobs.ninehirePageSize', 100),
    );
    this.detailBudget = Math.max(
      0,
      config.get<number>('externalJobs.ninehireDetailBudget', 200),
    );
  }

  get configured(): boolean {
    return this.sources.some((source) => source.enabled);
  }

  get enabledSources(): NinehireSource[] {
    return this.sources.filter((source) => source.enabled);
  }

  /** One rate-limited client per credential. */
  private clientFor(source: NinehireSource): ProviderHttpClient {
    const existing = this.clients.get(source.scope);
    if (existing) return existing;
    const client = new ProviderHttpClient({
      allowedHosts: this.descriptor.allowedHosts,
      minRequestIntervalMs: this.descriptor.minRequestIntervalMs,
      timeoutMs: this.config.get<number>(
        'externalJobs.requestTimeoutMs',
        20_000,
      ),
      maxAttempts: this.config.get<number>('externalJobs.maxAttempts', 3),
      fetchImpl: this.fetchImpl,
      sleepImpl: this.sleepImpl,
    });
    this.clients.set(source.scope, client);
    return client;
  }

  /** Built fresh per request; never stored, never returned. */
  private authFor(source: NinehireSource): AuthHeader {
    const token = readSecret(this.config, source.secretRef);
    if (!token) {
      // Should be unreachable: a source with no readable key is dropped at
      // construction. Failing loudly beats sending `Bearer undefined`.
      throw new Error(
        `Ninehire source ${source.scope} has no readable API key configured`,
      );
    }
    return { scheme: 'Bearer', token };
  }

  /**
   * One page of one workspace.
   *
   * The cursor is `scope@page`, so an interrupted sweep resumes on the right
   * workspace at the right page rather than restarting someone's catalogue.
   */
  async fetchPage(cursor: string | null): Promise<ProviderFetchPage> {
    const sources = this.enabledSources;
    const empty = {
      jobs: [],
      nextCursor: null,
      rejected: [],
      scopeKey: '',
      complete: false,
    };
    if (sources.length === 0) return empty;

    const position = parseCursor(cursor);
    const index = position
      ? sources.findIndex((source) => source.scope === position.scope)
      : 0;
    if (index < 0) {
      this.logger.warn(
        'Ninehire sweep cursor no longer matches a configured source; ending sweep',
      );
      return empty;
    }

    const source = sources[index];
    const page = position?.page ?? 1;
    const result = await this.fetchSourcePage(source, page);

    const more = result.fetched === this.pageSize;
    const nextCursor = more
      ? formatCursor(source.scope, page + 1)
      : (sources[index + 1]?.scope ?? null);

    return {
      jobs: result.jobs,
      rejected: result.rejected,
      scopeKey: source.scope,
      /*
       * Complete only when the whole workspace arrived in ONE request.
       *
       * `page`/`countPerPage` is offset pagination over a live collection, the
       * same hazard Lever has: a posting deleted between page 1 and page 3
       * shifts everything up and one is never returned. It would then look
       * absent, and absence is what retires a job. The envelope reports a
       * `count`, but its semantics are not documented clearly enough to prove
       * completeness with — and guessing at a field's meaning is precisely how
       * a live job gets retired.
       *
       * So a single short page is a snapshot and can retire; anything paged
       * cannot, and its jobs age to STALE instead.
       */
      complete: page === 1 && !more,
      nextCursor,
    };
  }

  private async fetchSourcePage(
    source: NinehireSource,
    page: number,
  ): Promise<{
    jobs: NormalizedExternalJobInput[];
    rejected: { sourceJobId: string | null; reason: string }[];
    fetched: number;
  }> {
    const http = this.clientFor(source);
    const auth = this.authFor(source);
    const url =
      `${NinehireProvider.API_BASE}?page=${page}` +
      `&countPerPage=${this.pageSize}` +
      /*
       * Unpublished postings ARE requested, because `closed` is the only
       * explicit closure evidence any provider gives us and it is only visible
       * here. Private postings are NOT requested: not asking is a stronger
       * guarantee than filtering, since unauthorized data is never received.
       */
      `&includeUnpublished=true&includePrivate=false`;

    const started = Date.now();
    const payload = await http.getJson<NinehireJobList>(url, auth);
    const raw = Array.isArray(payload?.results) ? payload.results : null;
    if (!raw) {
      // A shape change must never look like an empty workspace: an empty
      // COMPLETE workspace retires everything in it.
      throw new Error('Ninehire response did not contain a results array');
    }

    const ingestable: NinehireJob[] = [];
    const rejected: { sourceJobId: string | null; reason: string }[] = [];
    let excluded = 0;

    for (const entry of raw) {
      // The eligibility boundary, before anything else reads the posting.
      if (!ninehireIngestable(entry)) {
        excluded += 1;
        continue;
      }
      ingestable.push(entry);
    }

    /*
     * Descriptions live only on the detail endpoint, one call each, out of the
     * same 60/minute budget as the listing. For a Ninehire workspace — the
     * product targets 중소기업, small and mid-sized employers — that is a few
     * dozen calls and costs under a minute. For an unusually large workspace
     * it would not be, so it is bounded: past the budget, postings are still
     * ingested with every list field and simply no description.
     *
     * Crucially that does NOT make the snapshot incomplete. We saw every
     * posting; we chose not to fetch every body. Absence stays actionable.
     */
    const jobs: NormalizedExternalJobInput[] = [];
    let detailFetched = 0;
    let detailSkipped = 0;

    for (const entry of ingestable) {
      let enriched = entry;
      if (detailFetched < this.detailBudget) {
        try {
          const detail = await this.fetchDetail(source, entry, http, auth);
          /*
           * ONLY the description is taken from the detail response.
           *
           * A whole-object merge would let the detail endpoint overwrite the
           * id, the status and `isPrivate` — and eligibility was already
           * decided from the list, so a detail body disagreeing about privacy
           * would slip a private posting through a check that had already
           * passed. The list is authoritative for what it states; detail is
           * fetched for the one field it alone carries.
           */
          if (detail && typeof detail.content === 'string') {
            enriched = { ...entry, content: detail.content };
          }
          detailFetched += 1;
        } catch (error) {
          // A failed detail call costs a description, not the posting.
          detailSkipped += 1;
          this.logger.warn(
            `Ninehire detail unavailable for ${source.scope}/` +
              `${idOf(entry) ?? 'unknown'}: ${(error as Error).message}`,
          );
        }
      } else {
        detailSkipped += 1;
      }

      try {
        const normalized = normalizeNinehireJob(enriched, {
          scope: source.scope,
          label: source.label,
        });
        if (normalized) {
          jobs.push(normalized);
        } else {
          rejected.push({
            sourceJobId: idOf(entry),
            reason: 'Missing a usable id, title or apply URL',
          });
        }
      } catch (error) {
        rejected.push({
          sourceJobId: idOf(entry),
          // The message only. Postings carry contact details, and the
          // credential must never appear anywhere near a log line.
          reason: (error as Error).message,
        });
      }
    }

    this.logger.log(
      `Ninehire ${source.scope} [page=${page} size=${this.pageSize}]: ` +
        `fetched=${raw.length} ingestable=${ingestable.length} ` +
        `excluded=${excluded} detail=${detailFetched} ` +
        `detailSkipped=${detailSkipped} normalized=${jobs.length} ` +
        `rejected=${rejected.length} ${Date.now() - started}ms`,
    );

    return { jobs, rejected, fetched: raw.length };
  }

  /** The detail body for one posting, or null when it has gone. */
  private async fetchDetail(
    source: NinehireSource,
    entry: NinehireJob,
    http: ProviderHttpClient,
    auth: AuthHeader,
  ): Promise<NinehireJob | null> {
    const id = idOf(entry);
    if (!id) return null;
    /*
     * The default language is the workspace's Korean content, and that is what
     * is stored. Requesting `language=english` would return a DIFFERENT
     * representation of the SAME posting — not a second job — and storing both
     * would either duplicate the requisition or need a multilingual
     * description model no other provider needs. One canonical language, the
     * source's own.
     */
    const url = `${NinehireProvider.API_BASE}/${encodeURIComponent(id)}`;
    try {
      return await http.getJson<NinehireJob>(url, auth);
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return null;
      throw error;
    }
  }

  /**
   * Re-read one posting, for revalidation.
   *
   * `null` means the workspace no longer exposes it — deleted, or turned
   * private, or moved to a status this product does not list — which is
   * exactly the evidence the lifecycle reads as the source being GONE.
   */
  async fetchOne(
    sourceKey: string,
  ): Promise<NormalizedExternalJobInput | null> {
    const at = sourceKey.indexOf(':');
    if (at < 0) return null;
    const scope = sourceKey.slice(0, at);
    const postingId = sourceKey.slice(at + 1);
    const source = this.enabledSources.find((entry) => entry.scope === scope);
    if (!source || !postingId) return null;

    const http = this.clientFor(source);
    const auth = this.authFor(source);
    const url = `${NinehireProvider.API_BASE}/${encodeURIComponent(postingId)}`;
    try {
      const raw = await http.getJson<NinehireJob>(url, auth);
      if (!ninehireIngestable(raw)) return null;
      return normalizeNinehireJob(raw, {
        scope: source.scope,
        label: source.label,
      });
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return null;
      throw error;
    }
  }
}

/** `scope@page`. */
export function formatCursor(scope: string, page: number): string {
  return `${scope}@${page}`;
}

/**
 * A cursor this provider issued, or null.
 *
 * A malformed page number resets to 1 rather than being coerced: a
 * silently-repaired cursor is how a sweep loops over one page forever.
 */
export function parseCursor(
  cursor: string | null,
): { scope: string; page: number } | null {
  if (!cursor) return null;
  const at = cursor.lastIndexOf('@');
  if (at <= 0) return { scope: cursor, page: 1 };
  const scope = cursor.slice(0, at);
  const raw = cursor.slice(at + 1);
  if (!/^[0-9]{1,6}$/.test(raw)) return { scope, page: 1 };
  const page = Number(raw);
  return { scope, page: page >= 1 ? page : 1 };
}

/** Page size, bounded by the documented maximum of 100. */
export function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(10, Math.trunc(value)));
}

function idOf(entry: unknown): string | null {
  const id = (entry as { id?: unknown })?.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}
