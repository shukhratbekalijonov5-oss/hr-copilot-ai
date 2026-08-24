import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalJobProvider } from '../../external-job.provider';
import {
  ProviderHttpClient,
  ProviderNotFoundError,
  type ProviderFetch,
} from '../../provider-http';
import { normalizeGreenhouseJob } from './greenhouse.normalize';
import { parseBoardConfig, type GreenhouseBoard } from './greenhouse.boards';
import type {
  ExternalProviderDescriptor,
  NormalizedExternalJobInput,
  ProviderFetchPage,
} from '../../external-job.contract';
import type { GreenhouseJob, GreenhouseJobList } from './greenhouse.types';

/**
 * Greenhouse, read through its public Job Board API.
 *
 * ## Exactly what is used, and why nothing more
 *
 *   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
 *   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{id}
 *
 * These are the endpoints Greenhouse documents for building a public careers
 * page, they return published job posts, and they need no credential —
 * verified live against four boards, all 200 with no auth header.
 *
 * The Harvest API is a different product with a different purpose: private
 * candidate and recruiting data, behind an API key. It is not used here, not
 * configured here, and there is nowhere in this class to put a key. Greenhouse
 * is a JOB SOURCE to this product and nothing else — no applicants, no stages,
 * no offers, and no applications submitted back.
 *
 * ## One page per board
 *
 * The list endpoint is not paginated: it returns the whole board in one
 * response, alongside `meta.total`. That makes completeness CHECKABLE rather
 * than assumed — this provider only claims a listing is complete when the
 * array length equals the total the API reported, and that claim is what lets
 * the ingestion layer treat a missing posting as evidence it closed.
 *
 * The cursor therefore walks BOARDS, not offsets. Each fetch returns one
 * board, so memory stays bounded by the largest board rather than by the
 * number of boards configured, and an interrupted sweep resumes where it
 * stopped instead of re-reading everything.
 */
@Injectable()
export class GreenhouseProvider extends ExternalJobProvider {
  private readonly logger = new Logger(GreenhouseProvider.name);
  private readonly boards: GreenhouseBoard[];
  private readonly http: ProviderHttpClient;

  /**
   * The API host, and ONLY the API host.
   *
   * Job apply links live on `job-boards.greenhouse.io` and
   * `boards.greenhouse.io`, and some boards redirect to a customer's own
   * domain. Those URLs are STORED and shown to candidates; they are never
   * fetched. Adding every domain a posting might link to would widen the
   * fetch allowlist to "anywhere an upstream chooses", which is the thing an
   * allowlist exists to prevent.
   */
  static readonly API_HOST = 'boards-api.greenhouse.io';
  static readonly API_BASE = `https://${GreenhouseProvider.API_HOST}/v1/boards`;

  readonly descriptor: ExternalProviderDescriptor = {
    provider: 'GREENHOUSE',
    accessMethod: 'OFFICIAL_API',
    allowedHosts: [GreenhouseProvider.API_HOST],
    // One board at a time. Greenhouse publishes no rate limit for the Job
    // Board API, and the correct response to an unpublished limit is to stay
    // well inside any plausible one rather than to find it experimentally.
    maxConcurrency: 1,
    minRequestIntervalMs: 1_000,
    // Boards are swept every few hours; a posting unseen for two weeks has
    // genuinely stopped appearing rather than been missed.
    stalenessMs: 14 * 24 * 60 * 60_000,
    // Justified by `meta.total`: see the class note. The ingestion layer still
    // requires a per-run completeness proof before acting on absence.
    absenceImpliesClosed: true,
  };

  constructor(config: ConfigService, fetchImpl?: ProviderFetch) {
    super();
    this.boards = parseBoardConfig(
      config.get<string>('externalJobs.greenhouseBoards', ''),
      this.logger,
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

  /** The boards this deployment reads, for logs and run records. */
  get enabledBoards(): GreenhouseBoard[] {
    return this.boards.filter((board) => board.enabled);
  }

  /**
   * One board's jobs.
   *
   * The cursor is the next board token. Null starts at the first configured
   * board; null coming back means the sweep is done.
   */
  async fetchPage(cursor: string | null): Promise<ProviderFetchPage> {
    const boards = this.enabledBoards;
    if (boards.length === 0) {
      return {
        jobs: [],
        nextCursor: null,
        rejected: [],
        scopeKey: '',
        complete: false,
      };
    }

    const index = cursor
      ? boards.findIndex((board) => board.boardToken === cursor)
      : 0;
    if (index < 0) {
      // The configuration changed mid-sweep and this board is gone. Ending is
      // right: resuming from an arbitrary board would silently skip the ones
      // before it while still claiming the run was complete.
      this.logger.warn(
        'Greenhouse sweep cursor no longer matches a configured board; ending sweep',
      );
      return {
        jobs: [],
        nextCursor: null,
        rejected: [],
        scopeKey: '',
        complete: false,
      };
    }

    const board = boards[index];
    const next = boards[index + 1]?.boardToken ?? null;
    const page = await this.fetchBoard(board);
    return { ...page, nextCursor: next };
  }

  private async fetchBoard(
    board: GreenhouseBoard,
  ): Promise<Omit<ProviderFetchPage, 'nextCursor'>> {
    const url =
      `${GreenhouseProvider.API_BASE}/${encodeURIComponent(board.boardToken)}` +
      `/jobs?content=true&pay_transparency=true`;

    const started = Date.now();
    const payload = await this.http.getJson<GreenhouseJobList>(url);
    const raw = Array.isArray(payload?.jobs) ? payload.jobs : [];
    const reported =
      typeof payload?.meta?.total === 'number' ? payload.meta.total : null;

    const jobs: NormalizedExternalJobInput[] = [];
    const rejected: { sourceJobId: string | null; reason: string }[] = [];

    for (const entry of raw) {
      // Per-posting isolation at the FIRST layer it can happen. One board of
      // four hundred jobs must not be lost to one row with a broken URL.
      try {
        const normalized = normalizeGreenhouseJob(entry, board);
        if (normalized) {
          jobs.push(normalized);
        } else {
          rejected.push({
            sourceJobId: idOf(entry),
            reason: 'Missing a usable id, title or URL',
          });
        }
      } catch (error) {
        rejected.push({
          sourceJobId: idOf(entry),
          // The message only; the payload is never carried into a log or a
          // run record, because job postings contain contact details.
          reason: (error as Error).message,
        });
      }
    }

    /*
     * Completeness, proven rather than assumed.
     *
     * `meta.total` is the API's own count of the board. When it equals the
     * array we received, we have the whole board and a posting's absence is
     * real. When it does not — a truncated response, a shape change, a total
     * we cannot read — the listing is partial, `complete` is false, and
     * NOTHING will be closed on the strength of it.
     *
     * Note this counts the RAW array, not the normalized one: postings we
     * failed to map were still present on the board, and treating our own
     * mapping failure as the board being short would be exactly backwards.
     */
    const complete = reported !== null && reported === raw.length;
    if (!complete) {
      this.logger.warn(
        `Greenhouse board ${board.boardToken} returned ${raw.length} jobs but ` +
          `reported ${reported ?? 'no'} total; treating the listing as partial`,
      );
    }

    this.logger.log(
      `Greenhouse board ${board.boardToken}: fetched=${raw.length} ` +
        `normalized=${jobs.length} rejected=${rejected.length} ` +
        `complete=${complete} ${Date.now() - started}ms`,
    );

    return { jobs, rejected, scopeKey: board.boardToken, complete };
  }

  /**
   * Re-read one posting, for revalidation.
   *
   * `sourceKey` here is `boardToken:jobId` — the board is part of the address
   * because a Greenhouse job id is only meaningful within its board.
   *
   * A 404 returns null, which the lifecycle layer reads as "this source is
   * GONE". Every other failure throws, and proves nothing about the job. That
   * distinction is the whole reason this method exists.
   */
  async fetchOne(
    sourceKey: string,
  ): Promise<NormalizedExternalJobInput | null> {
    const [boardToken, jobId] = splitSourceKey(sourceKey);
    const board = this.enabledBoards.find(
      (candidate) => candidate.boardToken === boardToken,
    );
    if (!board || !jobId) return null;

    const url =
      `${GreenhouseProvider.API_BASE}/${encodeURIComponent(boardToken)}` +
      `/jobs/${encodeURIComponent(jobId)}`;
    try {
      const raw = await this.http.getJson<GreenhouseJob>(url);
      return normalizeGreenhouseJob(raw, board);
    } catch (error) {
      if (error instanceof ProviderNotFoundError) return null;
      throw error;
    }
  }
}

/** `board:jobId`. The board half is a slug, so the first colon splits it. */
export function splitSourceKey(key: string): [string, string | null] {
  const at = key.indexOf(':');
  if (at < 0) return [key, null];
  return [key.slice(0, at), key.slice(at + 1) || null];
}

function idOf(entry: unknown): string | null {
  const id = (entry as { id?: unknown })?.id;
  return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
}
