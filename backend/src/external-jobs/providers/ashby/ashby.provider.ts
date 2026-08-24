import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalJobProvider } from '../../external-job.provider';
import {
  ProviderHttpClient,
  ProviderNotFoundError,
  type ProviderFetch,
} from '../../provider-http';
import { parseScopeConfig, type ProviderScope } from '../../provider-scopes';
import { normalizeAshbyJob } from './ashby.normalize';
import type {
  ExternalProviderDescriptor,
  NormalizedExternalJobInput,
  ProviderFetchPage,
} from '../../external-job.contract';
import type { AshbyJobBoard } from './ashby.types';

/**
 * Ashby, read through its public Job Postings API.
 *
 * ## Exactly what is used
 *
 *   GET https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
 *
 * Ashby documents this for organizations hosting their own public career page.
 * The read path needs no credential — verified live against seven boards, all
 * 200 with no header.
 *
 * Ashby's authenticated RPC API (`jobPosting.list`, `job.info`, candidates,
 * applications, interview plans, offers) is a different product behind an API
 * key. It is not used, not configured, and there is nowhere in this class to
 * put a key.
 *
 * ## `isListed` — the rule that makes this provider different
 *
 * Greenhouse and Lever return only what is published. Ashby returns a posting
 * with an `isListed` flag, and `false` means "reachable by direct link but not
 * to be shown in a public listing". A job board that shows it anyway has
 * published something the employer deliberately unpublished.
 *
 * So unlisted postings are dropped HERE, at the provider boundary, and never
 * reach ingestion. That matters for more than tidiness: it means a posting
 * that goes listed → unlisted simply stops appearing in a complete snapshot,
 * and the existing lifecycle retires that source as GONE — "the source stopped
 * listing it" — rather than CLOSED, which would claim the employer ended a
 * role they are still quietly hiring for. No Ashby-only status was needed.
 *
 * ## One request per board
 *
 * The public endpoint returns the whole board in one response and documents no
 * pagination — confirmed live on boards from 29 to 150 postings. So a
 * successful, well-formed response IS a complete snapshot, and its absences
 * are real evidence.
 */
@Injectable()
export class AshbyProvider extends ExternalJobProvider {
  private readonly logger = new Logger(AshbyProvider.name);
  private readonly boards: ProviderScope[];
  private readonly http: ProviderHttpClient;

  /**
   * The API host, and only the API host.
   *
   * `jobUrl` and `applyUrl` live on `jobs.ashbyhq.com`; they are STORED and
   * shown to candidates, never fetched.
   */
  static readonly API_HOST = 'api.ashbyhq.com';
  static readonly API_BASE = `https://${AshbyProvider.API_HOST}/posting-api/job-board`;

  readonly descriptor: ExternalProviderDescriptor = {
    provider: 'ASHBY',
    accessMethod: 'OFFICIAL_API',
    allowedHosts: [AshbyProvider.API_HOST],
    // Ashby publishes no rate limit for the public read path. The right
    // response to an unpublished limit is to stay well inside any plausible
    // one rather than to find it experimentally.
    maxConcurrency: 1,
    minRequestIntervalMs: 1_000,
    stalenessMs: 14 * 24 * 60 * 60_000,
    // A single-request board snapshot can be complete; whether a given run
    // achieved one is decided per page below.
    absenceImpliesClosed: true,
  };

  constructor(config: ConfigService, fetchImpl?: ProviderFetch) {
    super();
    this.boards = parseScopeConfig(
      config.get<string>('externalJobs.ashbyBoards', ''),
      { logger: this.logger, provider: 'Ashby' },
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
    return this.boards.some((board) => board.enabled);
  }

  get enabledBoards(): ProviderScope[] {
    return this.boards.filter((board) => board.enabled);
  }

  /** One board per page; the cursor is the next board's name. */
  async fetchPage(cursor: string | null): Promise<ProviderFetchPage> {
    const boards = this.enabledBoards;
    const empty = {
      jobs: [],
      nextCursor: null,
      rejected: [],
      scopeKey: '',
      complete: false,
    };
    if (boards.length === 0) return empty;

    const index = cursor
      ? boards.findIndex((board) => board.slug === cursor)
      : 0;
    if (index < 0) {
      this.logger.warn(
        'Ashby sweep cursor no longer matches a configured board; ending sweep',
      );
      return empty;
    }

    const board = boards[index];
    const next = boards[index + 1]?.slug ?? null;
    const page = await this.fetchBoard(board);
    return { ...page, nextCursor: next };
  }

  private async fetchBoard(
    board: ProviderScope,
  ): Promise<Omit<ProviderFetchPage, 'nextCursor'>> {
    const url =
      `${AshbyProvider.API_BASE}/${encodeURIComponent(board.slug)}` +
      `?includeCompensation=true`;

    const started = Date.now();
    const payload = await this.http.getJson<AshbyJobBoard>(url);
    const raw = Array.isArray(payload?.jobs) ? payload.jobs : null;
    if (!raw) {
      // A shape change must not look like an empty board — an empty COMPLETE
      // board retires everything on it.
      throw new Error('Ashby board response did not contain a jobs array');
    }

    const jobs: NormalizedExternalJobInput[] = [];
    const rejected: { sourceJobId: string | null; reason: string }[] = [];
    let unlisted = 0;

    for (const entry of raw) {
      try {
        // The public/searchable boundary, enforced before anything else looks
        // at the posting.
        if (entry?.isListed === false) {
          unlisted += 1;
          continue;
        }
        const normalized = normalizeAshbyJob(entry, {
          slug: board.slug,
          label: board.label,
        });
        if (normalized) {
          jobs.push(normalized);
        } else {
          rejected.push({
            sourceJobId: idOf(entry),
            reason: 'Missing a usable id, title or job URL',
          });
        }
      } catch (error) {
        rejected.push({
          sourceJobId: idOf(entry),
          // The message only. Postings carry contact details and never reach a
          // log line or a run record.
          reason: (error as Error).message,
        });
      }
    }

    /*
     * Completeness. The endpoint returns the whole board in one response and
     * documents no pagination, so a well-formed response is a complete
     * snapshot. `getJson` has already thrown on a failed request, a body over
     * the size cap or unparseable JSON, and a missing `jobs` array threw
     * above — so reaching this line IS the completeness evidence.
     *
     * Unlisted postings do not make a snapshot incomplete: they were seen and
     * deliberately excluded, which is a decision rather than a gap.
     */
    this.logger.log(
      `Ashby board ${board.slug} [apiVersion=${apiVersionOf(payload)}]: ` +
        `fetched=${raw.length} listed=${raw.length - unlisted} unlisted=${unlisted} ` +
        `normalized=${jobs.length} rejected=${rejected.length} complete=true ` +
        `${Date.now() - started}ms`,
    );

    return { jobs, rejected, scopeKey: board.slug, complete: true };
  }

  /**
   * Re-read one posting, for revalidation.
   *
   * The public API addresses boards, not individual postings, so this re-reads
   * the board and finds the posting in it. `null` means the board no longer
   * lists it — which covers both "deleted" and "unlisted", and is exactly the
   * evidence the lifecycle treats as the source being GONE.
   */
  async fetchOne(
    sourceKey: string,
  ): Promise<NormalizedExternalJobInput | null> {
    const at = sourceKey.indexOf(':');
    if (at < 0) return null;
    const slug = sourceKey.slice(0, at);
    const postingId = sourceKey.slice(at + 1);
    const board = this.enabledBoards.find((entry) => entry.slug === slug);
    if (!board || !postingId) return null;

    try {
      const page = await this.fetchBoard(board);
      return page.jobs.find((job) => job.sourceJobId === sourceKey) ?? null;
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return null;
      throw error;
    }
  }
}

/** The reported API version, as a log-safe scalar. */
function apiVersionOf(payload: AshbyJobBoard | null | undefined): string {
  const version = payload?.apiVersion;
  return typeof version === 'string' || typeof version === 'number'
    ? String(version)
    : '?';
}

function idOf(entry: unknown): string | null {
  const id = (entry as { id?: unknown })?.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}
