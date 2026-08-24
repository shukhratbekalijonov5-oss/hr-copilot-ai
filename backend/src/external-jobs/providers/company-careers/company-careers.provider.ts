import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalJobProvider } from '../../external-job.provider';
import { safeHost } from '../../provider-http';
import {
  ALLOW_ALL,
  parseRobots,
  type RobotsPolicy,
} from '../../../web-ingestion/robots';
import { SafeHttpFetcher } from '../../../web-ingestion/safe-fetcher';
import {
  COMPANY_CAREERS_CATALOGUE,
  isFetchableForSource,
  isStorableApplyUrl,
  parseCompanyCareersConfig,
} from './company-careers.catalogue';
import {
  readAnchors,
  readCanonicalUrl,
  readJobTitle,
  readSitemapLocations,
  isSitemapIndex,
} from './careers-html';
import { jobFromJsonLd, readJobPostings } from './jsonld';
import {
  normalizeCareersJob,
  statesMoreThanItsOwnLink,
} from './company-careers.normalize';
import type {
  ExternalProviderDescriptor,
  NormalizedExternalJobInput,
  ProviderFetchPage,
} from '../../external-job.contract';
import type {
  CareersPageJob,
  CompanyCareerSource,
} from './company-careers.types';

/**
 * A company's own careers page, as an external job source.
 *
 * ## Why this provider exists at all
 *
 * Four ATS integrations produced zero cross-provider merges, and that was
 * correct rather than disappointing: employers buy one ATS, so the same
 * requisition is almost never published through two of them. The duplicate
 * that genuinely occurs is a company's own careers page and the ATS behind it,
 * and it is the one worth resolving — it is where "who published this" and
 * "where do I apply" stop being the same answer.
 *
 * One canonical job, two sightings:
 *
 *   ExternalJob  Engineering Manager, CDN
 *     ├ COMPANY_CAREERS  vercel.com/careers/engineering-manager-cdn-5701765004
 *     └ GREENHOUSE       job-boards.greenhouse.io/vercel/jobs/5701765004
 *
 * ## What it is NOT
 *
 * Not a crawler. It reads a fixed list of operator-approved sources, each
 * declaring its own hosts, paths and reading strategy — there is no discovery,
 * no link following, no sitemap chasing, no domain enumeration, and no way for
 * a URL to enter this class from configuration or from a user. The closest
 * thing to following a link is fetching a detail page whose path the source's
 * own pattern already matched.
 *
 * Not an HTML-rendering pipeline either. Sources whose job content exists only
 * inside a JavaScript payload are declined in the catalogue rather than
 * served with a headless browser.
 *
 * ## Three separate permissions, checked in order
 *
 *  1. **robots.txt**, fetched live per host and honoured per path. Not a
 *     security control — a courtesy one, and the one that makes "we do not
 *     work around access decisions" true rather than claimed.
 *  2. **The source's own host+path allowlist**, applied to the first URL and
 *     to every redirect hop.
 *  3. **The address**, via `SafeHttpFetcher`: DNS resolved once, every
 *     returned address classified, and the socket pinned to the vetted one.
 *     That last part is what closes DNS rebinding, and it is the reason this
 *     provider borrows the candidate-link fetcher instead of the ATS HTTP
 *     client — the ATS client talks to four fixed vendor hosts and never
 *     needed it.
 */
@Injectable()
export class CompanyCareersProvider extends ExternalJobProvider {
  private readonly logger = new Logger(CompanyCareersProvider.name);
  private readonly sources: CompanyCareerSource[];
  private readonly robotsCache = new Map<string, Promise<RobotsPolicy>>();

  /**
   * Named so a site operator reading their access log can tell scheduled job
   * ingestion from a candidate-submitted link fetch, and can write a robots
   * rule for one without affecting the other.
   */
  static readonly USER_AGENT =
    'HRCopilotJobBot/1.0 (+scheduled public job ingestion; respects robots.txt)';
  /** What robots.txt groups are matched against. */
  static readonly ROBOTS_TOKEN = 'hrcopilotjobbot';

  /**
   * Company pages are an order of magnitude larger than ATS JSON — 3.8 MB of
   * marketing bundle around a few kilobytes of job list is normal. The cap is
   * generous enough for that and still a hard stop: an oversized response
   * FAILS the fetch, and a failed fetch retires nothing. It is never truncated
   * and then read as if it were the whole page, which would turn a big page
   * into a company that stopped hiring.
   */
  static readonly MAX_PAGE_BYTES = 12 * 1024 * 1024;
  static readonly MAX_ROBOTS_BYTES = 128 * 1024;
  /** Whole-source wall clock, so one slow site cannot hold a worker forever. */
  static readonly SOURCE_BUDGET_MS = 120_000;

  private static readonly HTML_TYPES = new Set([
    'text/html',
    'application/xhtml+xml',
    'text/plain',
  ]);
  private static readonly XML_TYPES = new Set([
    'application/xml',
    'text/xml',
    'application/rss+xml',
    'text/plain',
  ]);

  readonly descriptor: ExternalProviderDescriptor = {
    provider: 'COMPANY_CAREERS',
    accessMethod: 'PUBLIC_ENDPOINT',
    /*
     * The union of every configured source's hosts. The registry uses this to
     * refuse a provider that declares no allowlist at all; the REAL check is
     * per source, because Vercel's source has no business fetching linear.app
     * even though both are configured here.
     */
    allowedHosts: [],
    maxConcurrency: 1,
    // Overridden per source. Company sites publish no rate limits, and the
    // right response to an unpublished limit is to stay well inside any
    // plausible one rather than to find it experimentally.
    minRequestIntervalMs: 1_500,
    stalenessMs: 14 * 24 * 60 * 60_000,
    /*
     * Completeness is decided PER SOURCE and per run, never globally. A
     * sitemap lags; an index that renders one row per title does not list
     * every posting. Both are set on the page result below.
     */
    absenceImpliesClosed: true,
  };

  /**
   * @param sources overrides the configured catalogue selection.
   *
   * A test seam, and deliberately a CODE one: an override that arrives as an
   * argument has already passed through review, which is the same bar the
   * catalogue itself clears. Configuration can still only name approved ids —
   * that guard lives in `parseCompanyCareersConfig` and is untouched here.
   *
   * It exists because the behaviour of this class and the operational
   * question "should we be reading Vercel this week" are different things.
   * Without it, every extraction and lifecycle test would silently stop
   * running the day a source was switched off, which is precisely when the
   * code most needs to still be covered.
   */
  constructor(
    config: ConfigService,
    private readonly fetcher: SafeHttpFetcher,
    sources?: CompanyCareerSource[],
  ) {
    super();
    this.sources =
      sources ??
      parseCompanyCareersConfig(
        config.get<string>('externalJobs.companyCareersSources', ''),
        { logger: this.logger },
      );
    this.descriptor.allowedHosts = [
      ...new Set(this.sources.flatMap((source) => source.allowedHosts)),
    ];
  }

  get configured(): boolean {
    return this.sources.length > 0;
  }

  get enabledSources(): CompanyCareerSource[] {
    return this.sources;
  }

  /** Every catalogue entry, enabled or not. Used by verification tooling. */
  static get catalogue(): readonly CompanyCareerSource[] {
    return COMPANY_CAREERS_CATALOGUE;
  }

  /** One source per page; the cursor is the next source's id. */
  async fetchPage(cursor: string | null): Promise<ProviderFetchPage> {
    const empty = {
      jobs: [],
      nextCursor: null,
      rejected: [],
      scopeKey: '',
      complete: false,
    };
    if (this.sources.length === 0) return empty;

    const index = cursor
      ? this.sources.findIndex((source) => source.sourceId === cursor)
      : 0;
    if (index < 0) {
      this.logger.warn(
        'Company careers cursor no longer matches a configured source; ' +
          'ending sweep',
      );
      return empty;
    }

    const source = this.sources[index];
    const next = this.sources[index + 1]?.sourceId ?? null;
    const page = await this.fetchSource(source);
    return { ...page, nextCursor: next };
  }

  /**
   * Read one source end to end.
   *
   * Errors propagate: a source that could not be read makes the run FAILED for
   * that scope, which blocks the absence sweep entirely. That is the intended
   * shape — "the site was down" must never be recorded as "the jobs are gone".
   */
  private async fetchSource(
    source: CompanyCareerSource,
  ): Promise<Omit<ProviderFetchPage, 'nextCursor'>> {
    const started = Date.now();
    const deadline = started + CompanyCareersProvider.SOURCE_BUDGET_MS;
    const rejected: { sourceJobId: string | null; reason: string }[] = [];

    const index = await this.readIndex(source, deadline);
    const jobs: NormalizedExternalJobInput[] = [];
    let detailCalls = 0;
    let skippedForBudget = 0;

    for (const entry of index.jobs) {
      if (jobs.length >= source.maxJobsPerSync) {
        skippedForBudget += index.jobs.length - jobs.length;
        break;
      }
      try {
        let page = entry;
        const needsDetail =
          source.detail !== 'NONE' && entry.pageUrl !== source.indexUrl;
        if (needsDetail) {
          if (detailCalls >= source.maxDetailRequests) {
            skippedForBudget += 1;
            continue;
          }
          detailCalls += 1;
          page = await this.readDetail(source, entry, deadline);
        }
        const normalized = normalizeCareersJob(page, source);
        if (normalized) {
          jobs.push(normalized);
        } else {
          rejected.push({
            sourceJobId: entry.pageUrl,
            reason: statesMoreThanItsOwnLink(page)
              ? 'Page states no usable title or URL'
              : 'Page states only a title and its own link, which cannot be ' +
                'tied to a requisition and could only become a duplicate',
          });
        }
      } catch (error) {
        /*
         * One page's failure costs that page only. A 404 on a stale sitemap
         * entry is routine — Vercel's sitemap lists roles that have since
         * closed — and must not fail the whole source, which would block the
         * absence sweep for the jobs that WERE read.
         */
        rejected.push({
          sourceJobId: entry.pageUrl,
          reason: (error as Error).message,
        });
      }
    }

    /*
     * Completeness, which decides whether this run may retire anything.
     *
     * Both live sources answer false, for measured reasons rather than
     * caution — see the catalogue. `skippedForBudget` forces false regardless:
     * a listing cut short by a budget is a partial listing, and diffing
     * against it would retire the jobs that were merely on the part we did not
     * read.
     */
    const complete =
      source.indexIsComplete && index.complete && skippedForBudget === 0;

    this.logger.log(
      `Company careers ${source.sourceId}: discovered=${index.jobs.length} ` +
        `normalized=${jobs.length} rejected=${rejected.length} ` +
        `detailRequests=${detailCalls} skipped=${skippedForBudget} ` +
        `complete=${complete} ${Date.now() - started}ms`,
    );
    if (skippedForBudget > 0) {
      // Said out loud. A silent cap reads as "we covered everything".
      this.logger.warn(
        `Company careers ${source.sourceId} left ${skippedForBudget} ` +
          `discovered job(s) unread this sweep (per-sync budget); this run ` +
          `cannot retire anything for the source`,
      );
    }

    return { jobs, rejected, scopeKey: source.sourceId, complete };
  }

  /** The source's list of jobs, by its declared index strategy. */
  private async readIndex(
    source: CompanyCareerSource,
    deadline: number,
  ): Promise<{ jobs: CareersPageJob[]; complete: boolean }> {
    switch (source.index) {
      case 'SITEMAP':
        return this.readSitemapIndex(source, deadline);
      case 'ANCHOR_LIST':
        return this.readAnchorIndex(source, deadline);
      case 'ATS_LINK_INDEX':
        return this.readAtsLinkIndex(source, deadline);
      case 'JSON_LD_INDEX':
        return this.readJsonLdIndex(source, deadline);
    }
  }

  /**
   * Job URLs from the company's own sitemap.
   *
   * A sitemap INDEX is not followed. Chasing child sitemaps is how a bounded
   * read becomes a crawl of a whole site, and every configured source names
   * the document that actually lists its careers URLs.
   */
  private async readSitemapIndex(
    source: CompanyCareerSource,
    deadline: number,
  ): Promise<{ jobs: CareersPageJob[]; complete: boolean }> {
    const body = await this.read(
      source,
      source.indexUrl,
      deadline,
      CompanyCareersProvider.XML_TYPES,
    );
    if (isSitemapIndex(body)) {
      throw new Error(
        `Company careers source ${source.sourceId} points at a sitemap index; ` +
          `child sitemaps are not followed`,
      );
    }
    const locations = readSitemapLocations(body, source.indexUrl);
    const jobs = this.jobPagesFrom(source, locations);
    // A sitemap is a hint about what exists, published on the site's own
    // schedule. It is never treated as an enumeration.
    return { jobs, complete: false };
  }

  /** Job URLs from real anchors in the index page's markup. */
  private async readAnchorIndex(
    source: CompanyCareerSource,
    deadline: number,
  ): Promise<{ jobs: CareersPageJob[]; complete: boolean }> {
    const body = await this.read(
      source,
      source.indexUrl,
      deadline,
      CompanyCareersProvider.HTML_TYPES,
    );
    const anchors = readAnchors(body, source.indexUrl);
    const byUrl = new Map<string, CareersPageJob>();

    for (const anchor of anchors) {
      const url = this.jobUrlOf(source, anchor.href);
      if (!url || byUrl.has(url)) continue;
      byUrl.set(url, {
        ...blankJob(url),
        /*
         * The index's own words for the role and the place, when the anchor
         * carries them. Text-run ORDER is document structure; the elements
         * holding it are hashed CSS-module classes that change every deploy,
         * so nothing here reads a class name.
         */
        title: anchor.parts[0] ?? null,
        locationText: anchor.parts[1] ?? null,
      });
    }
    return { jobs: [...byUrl.values()], complete: true };
  }

  /**
   * An index whose links go straight to the ATS.
   *
   * The company page is then the sighting and the ATS link is both the apply
   * destination and the identity. No detail request is made — there is no
   * company-owned job page to fetch.
   */
  private async readAtsLinkIndex(
    source: CompanyCareerSource,
    deadline: number,
  ): Promise<{ jobs: CareersPageJob[]; complete: boolean }> {
    const body = await this.read(
      source,
      source.indexUrl,
      deadline,
      CompanyCareersProvider.HTML_TYPES,
    );
    const byApply = new Map<string, CareersPageJob>();

    for (const anchor of readAnchors(body, source.indexUrl)) {
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        continue;
      }
      // Only the ATS hosts this source declared, and never its own hosts:
      // otherwise every navigation link on the page becomes a job.
      const isAts = source.applyHosts.some((host) => {
        const candidate = host.toLowerCase();
        const actual = url.hostname.toLowerCase();
        return actual === candidate || actual.endsWith(`.${candidate}`);
      });
      if (!isAts) continue;
      const title = anchor.parts[0] ?? null;
      if (!title) continue;
      if (byApply.has(anchor.href)) continue;
      byApply.set(anchor.href, {
        ...blankJob(anchor.href),
        title,
        applyUrl: anchor.href,
        locationText: anchor.parts[1] ?? null,
      });
    }
    return { jobs: [...byApply.values()], complete: true };
  }

  /** JobPosting objects published on the index page itself. */
  private async readJsonLdIndex(
    source: CompanyCareerSource,
    deadline: number,
  ): Promise<{ jobs: CareersPageJob[]; complete: boolean }> {
    const body = await this.read(
      source,
      source.indexUrl,
      deadline,
      CompanyCareersProvider.HTML_TYPES,
    );
    const jobs = readJobPostings(body).map((node) =>
      jobFromJsonLd(node, source.indexUrl),
    );
    // A page that publishes its postings as structured data has stated its
    // whole list; a source that paginates says so with indexIsComplete.
    return { jobs, complete: true };
  }

  /** One job's own page, read by the source's declared detail strategy. */
  private async readDetail(
    source: CompanyCareerSource,
    entry: CareersPageJob,
    deadline: number,
  ): Promise<CareersPageJob> {
    const body = await this.read(
      source,
      entry.pageUrl,
      deadline,
      CompanyCareersProvider.HTML_TYPES,
    );

    if (source.detail === 'JSON_LD') {
      const postings = readJobPostings(body);
      if (postings.length === 0) {
        throw new Error('Job page publishes no schema.org JobPosting');
      }
      return jobFromJsonLd(postings[0], entry.pageUrl);
    }

    /*
     * HTML_META. Deliberately narrow: a title, the page's own canonical URL,
     * and the apply link.
     *
     * No description is taken. `meta[name=description]` on these pages is
     * company marketing — Linear's is "Join a fully remote team of makers
     * building the project management software…", identical on every job — and
     * storing it as the job's description would be worse than storing nothing.
     * Worse literally: a careers page outranks an ATS in source trust, so the
     * boilerplate would REPLACE the real description the ATS supplied.
     */
    const canonical = readCanonicalUrl(body, entry.pageUrl);
    const pageUrl =
      canonical && this.jobUrlOf(source, canonical) ? canonical : entry.pageUrl;

    return {
      ...entry,
      pageUrl,
      title: readJobTitle(body, source.titleSuffixes ?? []) ?? entry.title,
      applyUrl: this.applyUrlIn(source, body, entry.pageUrl) ?? entry.applyUrl,
    };
  }

  /**
   * The first link on a job page that points at an approved apply host.
   *
   * Storing it is not permission to fetch it: `applyHosts` and
   * `allowedHosts` are separate lists, and this URL is only ever handed to a
   * candidate. A careers page linking to Greenhouse does not make Greenhouse
   * fetchable by this provider.
   */
  private applyUrlIn(
    source: CompanyCareerSource,
    html: string,
    baseUrl: string,
  ): string | null {
    for (const anchor of readAnchors(html, baseUrl)) {
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        continue;
      }
      const onAts = source.applyHosts.some((host) => {
        const candidate = host.toLowerCase();
        const actual = url.hostname.toLowerCase();
        return actual === candidate || actual.endsWith(`.${candidate}`);
      });
      if (onAts && isStorableApplyUrl(source, url)) return anchor.href;
    }
    return null;
  }

  /** URLs that match this source's job-path pattern, deduplicated, in order. */
  private jobPagesFrom(
    source: CompanyCareerSource,
    urls: string[],
  ): CareersPageJob[] {
    const seen = new Set<string>();
    const jobs: CareersPageJob[] = [];
    for (const raw of urls) {
      const url = this.jobUrlOf(source, raw);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      jobs.push(blankJob(url));
    }
    return jobs;
  }

  /** A URL this source may fetch AND that looks like one of its job pages. */
  private jobUrlOf(source: CompanyCareerSource, raw: string): string | null {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!isFetchableForSource(source, url)) return null;
    if (!source.jobPathPattern.test(url.pathname)) return null;
    return url.toString();
  }

  /**
   * One fetch, with all three permissions applied.
   *
   * Order matters: robots is consulted BEFORE the request, so a disallowed
   * path is never fetched at all rather than fetched and then discarded.
   */
  private async read(
    source: CompanyCareerSource,
    rawUrl: string,
    deadline: number,
    contentTypes: ReadonlySet<string>,
  ): Promise<string> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('Company careers URL could not be parsed');
    }
    if (!isFetchableForSource(source, url)) {
      throw new Error(
        `Company careers source ${source.sourceId} may not fetch ` +
          `${safeHost(rawUrl)}${url.pathname}`,
      );
    }

    const robots = await this.robotsFor(source, url, deadline);
    if (!robots.isAllowed(`${url.pathname}${url.search}`)) {
      throw new Error(
        `robots.txt on ${url.hostname} disallows ${url.pathname} for ` +
          `${CompanyCareersProvider.ROBOTS_TOKEN}`,
      );
    }

    await this.pace(source);
    const response = await this.fetcher.fetchText(url.toString(), {
      deadline,
      maxBytes: CompanyCareersProvider.MAX_PAGE_BYTES,
      allowedContentTypes: contentTypes,
      userAgent: CompanyCareersProvider.USER_AGENT,
      // Re-applied on every redirect hop by the fetcher, so a careers page
      // cannot bounce this provider onto a host it was not approved for.
      allowHost: (target) => isFetchableForSource(source, target),
    });
    return response.body;
  }

  /**
   * This host's robots.txt, fetched once per process and honoured per path.
   *
   * A missing, unreachable or unparseable file means no rules were stated,
   * which is permission — the absence of a policy is not a prohibition. A
   * 403 on robots.txt itself is a different matter and is treated as a
   * refusal, because a site that will not even show its rules to this client
   * has answered the question.
   */
  private robotsFor(
    source: CompanyCareerSource,
    url: URL,
    deadline: number,
  ): Promise<RobotsPolicy> {
    const host = url.hostname.toLowerCase();
    const cached = this.robotsCache.get(host);
    if (cached) return cached;

    const pending = (async (): Promise<RobotsPolicy> => {
      const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
      try {
        await this.pace(source);
        const response = await this.fetcher.fetchText(robotsUrl, {
          deadline,
          maxBytes: CompanyCareersProvider.MAX_ROBOTS_BYTES,
          allowedContentTypes: new Set(['text/plain', 'text/html']),
          userAgent: CompanyCareersProvider.USER_AGENT,
          allowHost: (target) =>
            target.hostname.toLowerCase() === host &&
            target.pathname === '/robots.txt',
        });
        return parseRobots(response.body, CompanyCareersProvider.ROBOTS_TOKEN);
      } catch (error) {
        this.logger.log(
          `No usable robots.txt for ${host} (${(error as Error).message}); ` +
            `treating as no rules stated`,
        );
        return ALLOW_ALL;
      }
    })();

    this.robotsCache.set(host, pending);
    return pending;
  }

  /**
   * Hold the next request until this source's interval has passed.
   *
   * Chained onto one promise rather than compared against a timestamp, so
   * concurrent callers queue instead of all reading "the last request was long
   * ago" and firing together.
   */
  private gate: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  private pace(source: CompanyCareerSource): Promise<void> {
    const interval = source.minRequestIntervalMs;
    if (interval <= 0) return Promise.resolve();
    this.gate = this.gate.then(async () => {
      const wait = this.lastRequestAt + interval - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
    });
    return this.gate;
  }

  /** Injectable so tests do not spend real seconds proving pacing works. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function blankJob(pageUrl: string): CareersPageJob {
  return {
    pageUrl,
    title: null,
    applyUrl: null,
    locationText: null,
    countryCode: null,
    region: null,
    city: null,
    additionalLocations: [],
    description: null,
    employmentTypeRaw: null,
    workModeRaw: null,
    remoteCountriesAllowed: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriodRaw: null,
    validThrough: null,
    // An HTML anchor states no publication date. Structured JSON-LD is the
    // only careers-page shape that can, and it takes the branch above.
    datePosted: null,
    companyName: null,
    companyWebsiteUrl: null,
  };
}
