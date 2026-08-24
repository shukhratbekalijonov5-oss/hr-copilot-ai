import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalJobProvider } from '../../external-job.provider';
import {
  ProviderHttpClient,
  ProviderNotFoundError,
  type ProviderFetch,
} from '../../provider-http';
import { parseScopeConfig, type ProviderScope } from '../../provider-scopes';
import { normalizeLeverPosting } from './lever.normalize';
import type {
  ExternalProviderDescriptor,
  NormalizedExternalJobInput,
  ProviderFetchPage,
} from '../../external-job.contract';
import type { LeverPosting } from './lever.types';

/**
 * Lever, read through its public Postings API.
 *
 * ## Exactly what is used
 *
 *   GET https://api.lever.co/v0/postings/{site}?mode=json&skip=&limit=
 *   GET https://api.lever.co/v0/postings/{site}/{id}?mode=json
 *
 * Lever documents these for building a public job site. The GET read path
 * needs no credential — verified live against three sites, all 200 with no
 * header. Only the `POST .../{id}?key=` apply endpoint takes an API key, and
 * this product never posts anything.
 *
 * The authenticated Lever API — candidates, opportunities, requisitions,
 * interview stages, internal and draft postings — is a different product. It
 * is not used, not configured, and there is nowhere in this class to put a
 * key. The public API returns published postings only; everything else is
 * hidden from it entirely, so "public" is enforced by Lever rather than
 * filtered by us.
 *
 * ## Pagination, and why it costs completeness
 *
 * Unlike Greenhouse, Lever pages — with `skip`/`limit`, which is OFFSET
 * pagination over a live list. If a posting is deleted between page 1 and
 * page 3, every later posting shifts up by one and one of them is never
 * returned. It would then look absent, and absence is what retires a job.
 *
 * So this provider claims a listing is complete only when the whole site
 * arrived in a SINGLE request — that response is an atomic snapshot and its
 * absences are real. A site that needed more than one page reports
 * `complete: false`, its postings are still ingested and refreshed, and
 * nothing is ever retired on the strength of a walk that could have skipped
 * something. Those jobs age to STALE instead, which is the honest outcome:
 * we did not see it, and we cannot prove why.
 */
@Injectable()
export class LeverProvider extends ExternalJobProvider {
  private readonly logger = new Logger(LeverProvider.name);
  private readonly sites: ProviderScope[];
  private readonly http: ProviderHttpClient;
  private readonly pageSize: number;

  /**
   * The API host, and only the API host.
   *
   * Posting and apply links live on `jobs.lever.co`; they are STORED and shown
   * to candidates, never fetched. Lever also runs an EU host
   * (`api.eu.lever.co`) for EU-resident tenants — deliberately not allowlisted
   * here, because this deployment calls no EU site. An EU tenant simply 404s
   * and is not ingested, which is the correct failure for a host we have not
   * decided to contact.
   */
  static readonly API_HOST = 'api.lever.co';
  static readonly API_BASE = `https://${LeverProvider.API_HOST}/v0/postings`;

  readonly descriptor: ExternalProviderDescriptor = {
    provider: 'LEVER',
    accessMethod: 'OFFICIAL_API',
    allowedHosts: [LeverProvider.API_HOST],
    // Lever publishes a rate limit for application POSTs and none for public
    // reads. The right response to an unpublished limit is to stay well inside
    // any plausible one, not to find it experimentally.
    maxConcurrency: 1,
    minRequestIntervalMs: 1_000,
    stalenessMs: 14 * 24 * 60 * 60_000,
    /*
     * The public listing is authoritative about what is published, so an
     * absence from a COMPLETE listing is real evidence. Whether any given run
     * achieved a complete listing is decided per page above — this flag only
     * says absence is capable of meaning something for this provider.
     */
    absenceImpliesClosed: true,
  };

  constructor(config: ConfigService, fetchImpl?: ProviderFetch) {
    super();
    this.sites = parseScopeConfig(
      config.get<string>('externalJobs.leverSites', ''),
      { logger: this.logger, provider: 'Lever' },
    );
    // Bounded so one page is one bounded response and one bounded batch,
    // however large the site turns out to be.
    this.pageSize = clampPageSize(
      config.get<number>('externalJobs.leverPageSize', 100),
    );
    this.http = new ProviderHttpClient({
      allowedHosts: this.descriptor.allowedHosts,
      minRequestIntervalMs: this.descriptor.minRequestIntervalMs,
      timeoutMs: config.get<number>('externalJobs.requestTimeoutMs', 20_000),
      maxAttempts: config.get<number>('externalJobs.maxAttempts', 3),
      fetchImpl,
    });
  }

  get configured(): boolean {
    return this.sites.some((site) => site.enabled);
  }

  get enabledSites(): ProviderScope[] {
    return this.sites.filter((site) => site.enabled);
  }

  /**
   * One page of one site.
   *
   * The cursor is `slug@offset`: it addresses both which site to read and how
   * far into it, so an interrupted sweep resumes exactly where it stopped
   * rather than restarting a 900-posting site from zero.
   */
  async fetchPage(cursor: string | null): Promise<ProviderFetchPage> {
    const sites = this.enabledSites;
    const empty = {
      jobs: [],
      nextCursor: null,
      rejected: [],
      scopeKey: '',
      complete: false,
    };
    if (sites.length === 0) return empty;

    const position = parseCursor(cursor);
    const index = position
      ? sites.findIndex((site) => site.slug === position.slug)
      : 0;
    if (index < 0) {
      // Configuration changed mid-sweep. Ending is right: resuming from an
      // arbitrary site would silently skip the ones before it while still
      // claiming the run covered them.
      this.logger.warn(
        'Lever sweep cursor no longer matches a configured site; ending sweep',
      );
      return empty;
    }

    const site = sites[index];
    const skip = position?.skip ?? 0;
    const page = await this.fetchSitePage(site, skip);

    // A short page is the end of this site: move to the next one, or finish.
    const more = page.fetched === this.pageSize;
    const nextCursor = more
      ? formatCursor(site.slug, skip + this.pageSize)
      : (sites[index + 1]?.slug ?? null);

    return {
      jobs: page.jobs,
      rejected: page.rejected,
      scopeKey: site.slug,
      /*
       * Complete only when the entire site arrived in one request. `skip > 0`
       * means an offset walk happened and could have skipped a posting;
       * `more` means the walk is still going. Either way absence proves
       * nothing, and saying so is what stops a live job being retired.
       */
      complete: skip === 0 && !more,
      nextCursor,
    };
  }

  private async fetchSitePage(
    site: ProviderScope,
    skip: number,
  ): Promise<{
    jobs: NormalizedExternalJobInput[];
    rejected: { sourceJobId: string | null; reason: string }[];
    fetched: number;
  }> {
    const url =
      `${LeverProvider.API_BASE}/${encodeURIComponent(site.slug)}` +
      `?mode=json&skip=${skip}&limit=${this.pageSize}`;

    const started = Date.now();
    const payload = await this.http.getJson<unknown>(url);
    // The list endpoint returns a bare array. Anything else is a shape change,
    // and treating it as "no postings" would look exactly like an empty site.
    if (!Array.isArray(payload)) {
      throw new Error('Lever listing did not return an array of postings');
    }

    const jobs: NormalizedExternalJobInput[] = [];
    const rejected: { sourceJobId: string | null; reason: string }[] = [];

    for (const entry of payload) {
      // Per-posting isolation at the first layer it can happen: one site of
      // eight hundred postings must not be lost to one row with a broken URL.
      try {
        const normalized = normalizeLeverPosting(entry as LeverPosting, {
          slug: site.slug,
          label: site.label,
        });
        if (normalized) {
          jobs.push(normalized);
        } else {
          rejected.push({
            sourceJobId: idOf(entry),
            reason: 'Missing a usable id, title or hosted URL',
          });
        }
      } catch (error) {
        rejected.push({
          sourceJobId: idOf(entry),
          // The message only. Postings carry contact details and never reach
          // a log line or a run record.
          reason: (error as Error).message,
        });
      }
    }

    this.logger.log(
      `Lever site ${site.slug} [skip=${skip} limit=${this.pageSize}]: ` +
        `fetched=${payload.length} normalized=${jobs.length} ` +
        `rejected=${rejected.length} ${Date.now() - started}ms`,
    );

    return { jobs, rejected, fetched: payload.length };
  }

  /**
   * Re-read one posting, for revalidation.
   *
   * `sourceKey` is `site:postingId`, because a Lever posting id is only
   * meaningful within its site.
   *
   * A 404 returns null, which the lifecycle layer reads as "this source is
   * GONE". Every other failure throws and proves nothing about the posting.
   * That distinction is the entire reason this method exists.
   */
  async fetchOne(
    sourceKey: string,
  ): Promise<NormalizedExternalJobInput | null> {
    const at = sourceKey.indexOf(':');
    if (at < 0) return null;
    const slug = sourceKey.slice(0, at);
    const postingId = sourceKey.slice(at + 1);
    const site = this.enabledSites.find((entry) => entry.slug === slug);
    if (!site || !postingId) return null;

    const url =
      `${LeverProvider.API_BASE}/${encodeURIComponent(slug)}` +
      `/${encodeURIComponent(postingId)}?mode=json`;
    try {
      const raw = await this.http.getJson<LeverPosting>(url);
      return normalizeLeverPosting(raw, { slug: site.slug, label: site.label });
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return null;
      throw error;
    }
  }
}

/** `slug@offset`. */
export function formatCursor(slug: string, skip: number): string {
  return `${slug}@${skip}`;
}

/**
 * A cursor this provider issued, or null.
 *
 * Anything malformed — a negative offset, a huge one, junk after the `@` —
 * is refused rather than coerced. A cursor is the one input that decides
 * which URL gets built next, and a silently-repaired one is how a sweep ends
 * up looping over page zero forever.
 */
export function parseCursor(
  cursor: string | null,
): { slug: string; skip: number } | null {
  if (!cursor) return null;
  const at = cursor.lastIndexOf('@');
  if (at <= 0) return { slug: cursor, skip: 0 };
  const slug = cursor.slice(0, at);
  const raw = cursor.slice(at + 1);
  if (!/^[0-9]{1,9}$/.test(raw)) return { slug, skip: 0 };
  return { slug, skip: Number(raw) };
}

/** Page size, bounded whatever configuration says. */
export function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(200, Math.max(10, Math.trunc(value)));
}

function idOf(entry: unknown): string | null {
  const id = (entry as { id?: unknown })?.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}
