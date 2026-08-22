import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LinkFailureCode } from '../generated/prisma/enums';
import { SafeHttpFetcher } from './safe-fetcher';
import { PageRenderer } from './renderer';
import { WebIngestionError } from './web-ingestion.errors';
import {
  parseCandidateUrl,
  type LinkDetectedType,
  type NormalizedUrl,
} from './url-policy';
import {
  extractHtml,
  extractPlainText,
  normalizeWhitespace,
  type ExtractedPage,
  type ExtractedSection,
} from './html-extract';
import { extractEmbeddedJson } from './embedded-json';
import { assessContentQuality, isRenderable } from './content-quality';
import { discoverSubpages } from './subpage-discovery';
import { ALLOW_ALL, parseRobots, type RobotsPolicy } from './robots';
import { WEB_INGESTION_LIMITS } from './web-ingestion.limits';

/**
 * URL → normalized evidence, end to end.
 *
 * This is the whole "fetching boundary" the architecture doc names: network
 * egress to candidate-supplied destinations happens HERE, in the backend, and
 * nowhere else. The AI service never opens a socket to the internet — it
 * receives already-fetched, already-bounded, already-normalized text and does
 * what it does for files: chunk, embed, index.
 *
 * That split is deliberate. The backend already owns the queue (retries,
 * backoff, idempotency), object storage and every authorization decision, so
 * the dangerous operation lives next to the machinery that bounds it, and the
 * AI service keeps exactly one trust rule to reason about: everything it is
 * handed is untrusted data.
 *
 * The pipeline, in order, each stage only running if the previous one was
 * insufficient:
 *
 *   robots.txt  →  static fetch  →  HTML extraction  →  quality gate
 *                                        ↓ thin
 *                                   embedded hydration payload
 *                                        ↓ still thin
 *                                   headless render (opt-in)
 *                                        ↓
 *                            bounded same-origin subpages
 */
@Injectable()
export class WebIngestionService {
  private readonly logger = new Logger(WebIngestionService.name);

  constructor(
    private readonly fetcher: SafeHttpFetcher,
    private readonly renderer: PageRenderer,
  ) {}

  /**
   * Fetches and normalizes one professional link.
   *
   * Throws WebIngestionError with a typed, localizable code. The caller
   * persists that code; the raw detail only ever reaches the log.
   */
  async ingest(
    rawUrl: string,
    options: { label?: string } = {},
  ): Promise<IngestedWebSource> {
    const started = Date.now();
    const deadline = started + WEB_INGESTION_LIMITS.totalBudgetMs;
    const target = parseCandidateUrl(rawUrl);

    try {
      const result = await this.run(target, deadline);
      this.logger.log(
        `Web source ingested: ${describe(options.label, target)} ` +
          `mode=${result.fetchMode} pages=${result.pagesFetched} ` +
          `chars=${result.charCount} sections=${result.sections.length} ` +
          `durationMs=${Date.now() - started}`,
      );
      return result;
    } catch (error) {
      const code =
        error instanceof WebIngestionError
          ? error.code
          : LinkFailureCode.UPSTREAM_ERROR;
      // Safe observability: identifiers, the failure code and timings. Never
      // the extracted text — it is a person's private evidence — and never a
      // raw upstream body.
      this.logger.warn(
        `Web source failed: ${describe(options.label, target)} ` +
          `code=${code} durationMs=${Date.now() - started} ` +
          `detail=${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw error instanceof WebIngestionError
        ? error
        : new WebIngestionError(
            LinkFailureCode.UPSTREAM_ERROR,
            (error as Error).message,
          );
    }
  }

  private async run(
    target: NormalizedUrl,
    deadline: number,
  ): Promise<IngestedWebSource> {
    const robots = await this.readRobots(target.href, deadline);
    this.assertRobotsAllows(robots, target.href);

    const main = await this.readPage(target.href, deadline);

    const sections = this.toNormalizedSections(main.page, main.url);
    let charCount = sumChars(sections);
    let pagesFetched = 1;

    // Bounded expansion: subpages come from the SUBMITTED page only, and each
    // one is re-checked against robots and the remaining budget.
    for (const subpageUrl of discoverSubpages(main.url, main.page.links)) {
      if (pagesFetched >= WEB_INGESTION_LIMITS.maxPagesPerLink) break;
      if (charCount >= WEB_INGESTION_LIMITS.maxExtractedChars) break;
      if (Date.now() >= deadline) break;
      if (!allows(robots, subpageUrl)) continue;

      try {
        const subpage = await this.readPage(subpageUrl, deadline, {
          allowRender: false,
        });
        pagesFetched += 1;
        for (const section of this.toNormalizedSections(
          subpage.page,
          subpage.url,
        )) {
          if (
            charCount + section.text.length >
            WEB_INGESTION_LIMITS.maxExtractedChars
          ) {
            break;
          }
          sections.push(section);
          charCount += section.text.length;
        }
      } catch (error) {
        // A subpage is a bonus, never a requirement: the submitted page
        // already produced usable evidence, and one broken /about must not
        // fail the whole source.
        this.logger.debug(
          `Skipped subpage ${subpageUrl}: ${(error as Error).message}`,
        );
      }
    }

    const deduped = dedupeSections(sections);
    return {
      finalUrl: main.url,
      title: main.page.title,
      description: main.page.description,
      detectedType: target.detectedType,
      sections: deduped,
      charCount: sumChars(deduped),
      pagesFetched,
      fetchMode: main.fetchMode,
      contentHash: hashSections(deduped),
    };
  }

  /**
   * One page, through as many strategies as it takes.
   *
   * The escalation is strictly needs-driven — a page whose static HTML is
   * already good never touches the JSON reader and never starts a browser.
   */
  private async readPage(
    url: string,
    deadline: number,
    options: { allowRender?: boolean } = {},
  ): Promise<{ page: ExtractedPage; url: string; fetchMode: FetchMode }> {
    const response = await this.fetcher.fetchText(url, {
      deadline,
      // Pages get the larger cap: an SPA's inline bundle is not a reason to
      // refuse the readable markup around it. See maxPageBytes.
      maxBytes: WEB_INGESTION_LIMITS.maxPageBytes,
    });

    if (response.mediaType === 'text/plain') {
      const page = extractPlainText(response.body);
      this.assertUsable(page.sections, response.url);
      return { page, url: response.url, fetchMode: 'STATIC' };
    }

    const page = extractHtml(response.body, response.url);
    const verdict = assessContentQuality(page.sections);
    if (verdict.ok) {
      return { page, url: response.url, fetchMode: 'STATIC' };
    }
    if (!isRenderable(verdict.reason)) {
      // A login wall, a captcha or a 404 page. Rendering it would be an
      // attempt to get around the site's own decision.
      throw new WebIngestionError(
        LinkFailureCode.ACCESS_DENIED,
        `Page is not publicly readable (${verdict.reason})`,
      );
    }

    // Strategy 2: the content is probably in the hydration payload.
    const embedded = extractEmbeddedJson(response.body);
    if (embedded.sections.length > 0) {
      const merged = mergeMeta(page, embedded.sections);
      if (assessContentQuality(merged.sections).ok) {
        return { page: merged, url: response.url, fetchMode: 'STATIC' };
      }
    }

    // Strategy 3: a real browser, if this deployment enabled one.
    if (options.allowRender !== false && this.renderer.available) {
      const rendered = await this.renderer.render(response.url, deadline);
      const renderedPage = extractHtml(rendered.html, rendered.url);
      const renderedVerdict = assessContentQuality(renderedPage.sections);
      if (renderedVerdict.ok) {
        return { page: renderedPage, url: rendered.url, fetchMode: 'RENDERED' };
      }
      if (!isRenderable(renderedVerdict.reason)) {
        throw new WebIngestionError(
          LinkFailureCode.ACCESS_DENIED,
          `Rendered page is not publicly readable (${renderedVerdict.reason})`,
        );
      }
    }

    throw new WebIngestionError(
      LinkFailureCode.NO_MEANINGFUL_CONTENT,
      `No usable text could be extracted (${verdict.reason})`,
    );
  }

  private assertUsable(sections: ExtractedSection[], url: string): void {
    const verdict = assessContentQuality(sections);
    if (verdict.ok) return;
    throw new WebIngestionError(
      verdict.reason === 'access-wall' || verdict.reason === 'error-page'
        ? LinkFailureCode.ACCESS_DENIED
        : LinkFailureCode.NO_MEANINGFUL_CONTENT,
      `No usable text at ${new URL(url).pathname} (${verdict.reason})`,
    );
  }

  /** Best-effort: no robots.txt means no stated rules, which means allowed. */
  private async readRobots(
    pageUrl: string,
    deadline: number,
  ): Promise<RobotsPolicy> {
    let robotsUrl: string;
    try {
      robotsUrl = new URL('/robots.txt', pageUrl).toString();
    } catch {
      return ALLOW_ALL;
    }

    try {
      const response = await this.fetcher.fetchText(robotsUrl, {
        deadline: Math.min(deadline, Date.now() + 5_000),
        maxBytes: WEB_INGESTION_LIMITS.maxRobotsBytes,
        allowedContentTypes: new Set([
          'text/plain',
          'text/html',
          'application/xhtml+xml',
        ]),
      });
      return parseRobots(response.body, WEB_INGESTION_LIMITS.userAgent);
    } catch {
      return ALLOW_ALL;
    }
  }

  private assertRobotsAllows(robots: RobotsPolicy, url: string): void {
    if (allows(robots, url)) return;
    throw new WebIngestionError(
      LinkFailureCode.ACCESS_DENIED,
      "The site's robots.txt disallows automated access to this page",
    );
  }

  /** Attaches per-page provenance so a citation can name the exact page. */
  private toNormalizedSections(
    page: ExtractedPage,
    url: string,
  ): NormalizedSection[] {
    const sections: NormalizedSection[] = page.sections.map((section) => ({
      ...section,
      url,
    }));

    // The meta description is often the only prose on an otherwise visual
    // landing page, and it is what the candidate wrote about themselves.
    if (page.description && page.description.length >= 40) {
      sections.unshift({
        name: 'summary',
        heading: null,
        text: normalizeWhitespace(page.description),
        url,
      });
    }
    return sections;
  }
}

export type FetchMode = 'STATIC' | 'RENDERED';

/** One section of extracted evidence, with the page it came from. */
export interface NormalizedSection extends ExtractedSection {
  url: string;
}

export interface IngestedWebSource {
  /** After redirects — the URL the content actually came from. */
  finalUrl: string;
  title: string | null;
  description: string | null;
  detectedType: LinkDetectedType;
  sections: NormalizedSection[];
  charCount: number;
  pagesFetched: number;
  fetchMode: FetchMode;
  /** SHA-256 of the normalized text. Detects "nothing changed" on a refresh. */
  contentHash: string;
}

function allows(robots: RobotsPolicy, url: string): boolean {
  try {
    const parsed = new URL(url);
    return robots.isAllowed(`${parsed.pathname}${parsed.search}`);
  } catch {
    return false;
  }
}

function mergeMeta(
  page: ExtractedPage,
  extra: ExtractedSection[],
): ExtractedPage {
  return {
    ...page,
    sections: [...page.sections, ...extra],
    charCount: page.charCount + sumChars(extra),
  };
}

function sumChars(sections: { text: string }[]): number {
  return sections.reduce((total, section) => total + section.text.length, 0);
}

/**
 * Removes text repeated across pages of the same site — the "about" blurb that
 * appears on every page. Without this, a 4-page portfolio embeds its footer
 * bio four times and every query matches all four.
 */
function dedupeSections(sections: NormalizedSection[]): NormalizedSection[] {
  const seen = new Set<string>();
  const out: NormalizedSection[] = [];
  for (const section of sections) {
    const key = section.text.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(section);
  }
  return out;
}

function hashSections(sections: NormalizedSection[]): string {
  const hash = createHash('sha256');
  for (const section of sections) {
    hash.update(section.name ?? '');
    hash.update(' ');
    hash.update(section.text);
    hash.update(' ');
  }
  return hash.digest('hex');
}

function describe(label: string | undefined, target: NormalizedUrl): string {
  // The host is safe to log; the full URL with its query is closer to personal
  // data and adds nothing to an operational log line.
  return `${label ? `${label} ` : ''}host=${target.hostname}`;
}
