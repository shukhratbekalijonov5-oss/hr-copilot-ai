import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LinkFailureCode } from '../generated/prisma/enums';
import { WebIngestionError } from './web-ingestion.errors';
import { classifyAddress } from './ip-guard';
import { assertFetchableUrl } from './url-policy';
import { WEB_INGESTION_LIMITS } from './web-ingestion.limits';

/**
 * The last-resort fallback for pages that genuinely need a browser.
 *
 * ## Why it is a port, and why it is off by default
 *
 * Most "JS-rendered portfolio" pages are not actually unreadable: their
 * content ships as a hydration payload, which `embedded-json.ts` recovers with
 * no browser at all. The residue that truly needs a DOM is small, and paying
 * for it means a ~300 MB Chromium download in every install and every CI run,
 * plus a process that executes untrusted third-party JavaScript.
 *
 * So the capability is a seam, not a dependency: `WEB_RENDER_ENABLED=true`
 * plus a resolvable `playwright` turns it on, and everything else in the
 * pipeline is written against the interface. With it off, a page that no other
 * strategy can read fails as NO_MEANINGFUL_CONTENT with a reason a candidate
 * can act on — which is the honest outcome, not a silent gap.
 *
 * ## Security, when it IS on
 *
 * Executing a stranger's JavaScript inside the backend's network is the most
 * dangerous thing this feature can do, so the same rules hold as for a plain
 * fetch, applied to the browser rather than to a socket:
 *
 *   - every request the page makes is intercepted and re-validated: protocol,
 *     port, hostname policy, and the resolved IP. A subresource or an in-page
 *     `fetch()` to 169.254.169.254 is aborted, not proxied;
 *   - navigation away from the validated origin chain is refused;
 *   - downloads are refused and no file is ever written;
 *   - images, media, fonts and stylesheets are blocked — they cost time and
 *     bandwidth and contain no text;
 *   - a hard timeout, a fresh ephemeral context per page (no profile, no
 *     storage, no cookies carried between links), and the browser is closed
 *     after every render;
 *   - JavaScript dialogs are dismissed so a modal cannot stall the render.
 */

export interface RenderedPage {
  /** Fully rendered HTML, fed back through the same extractor as static HTML. */
  html: string;
  /** URL after any in-page navigation. */
  url: string;
}

export abstract class PageRenderer {
  abstract readonly available: boolean;
  abstract render(url: string, deadline: number): Promise<RenderedPage>;
}

/** What runs when the fallback is not enabled: nothing, loudly. */
@Injectable()
export class DisabledPageRenderer extends PageRenderer {
  readonly available = false;

  render(): Promise<RenderedPage> {
    return Promise.reject(
      new WebIngestionError(
        LinkFailureCode.NO_MEANINGFUL_CONTENT,
        'Page requires JavaScript rendering, which is not enabled',
      ),
    );
  }
}

/** Minimal structural view of the Playwright API this adapter uses. */
interface PlaywrightLike {
  chromium: {
    launch(options: Record<string, unknown>): Promise<BrowserLike>;
  };
}
interface BrowserLike {
  newContext(options: Record<string, unknown>): Promise<ContextLike>;
  close(): Promise<void>;
}
interface ContextLike {
  route(
    pattern: string,
    handler: (route: RouteLike, request: RequestLike) => Promise<void> | void,
  ): Promise<void>;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
interface RouteLike {
  abort(reason?: string): Promise<void>;
  continue(): Promise<void>;
}
interface RequestLike {
  url(): string;
  resourceType(): string;
}
interface PageLike {
  on(event: string, handler: (payload: unknown) => void): void;
  goto(url: string, options: Record<string, unknown>): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
  waitForTimeout(ms: number): Promise<void>;
}

@Injectable()
export class PlaywrightPageRenderer extends PageRenderer {
  private readonly logger = new Logger(PlaywrightPageRenderer.name);
  private readonly enabled: boolean;
  private playwright: PlaywrightLike | null = null;

  constructor(config: ConfigService) {
    super();
    this.enabled = config.get<boolean>('webIngestion.renderEnabled', false);
  }

  get available(): boolean {
    return this.enabled;
  }

  async render(url: string, deadline: number): Promise<RenderedPage> {
    if (!this.enabled) {
      throw new WebIngestionError(
        LinkFailureCode.NO_MEANINGFUL_CONTENT,
        'Page requires JavaScript rendering, which is not enabled',
      );
    }

    const playwright = await this.load();
    const budget = Math.min(
      WEB_INGESTION_LIMITS.renderTimeoutMs,
      Math.max(1_000, deadline - Date.now()),
    );

    const browser = await playwright.chromium.launch({
      headless: true,
      // No sandbox-weakening flags. Chromium's own sandbox is the innermost
      // layer of defence around code we did not write.
      args: ['--disable-dev-shm-usage', '--disable-gpu'],
      timeout: budget,
    });

    try {
      const context = await browser.newContext({
        // Ephemeral by construction: no storage state in, none persisted out,
        // so nothing is carried between two candidates' links.
        userAgent: WEB_INGESTION_LIMITS.userAgent,
        acceptDownloads: false,
        javaScriptEnabled: true,
        bypassCSP: false,
        serviceWorkers: 'block',
        viewport: { width: 1280, height: 1024 },
      });

      // The SSRF policy, re-applied to every single request the page makes.
      await context.route('**/*', async (route, request) => {
        const requestUrl = request.url();
        const type = request.resourceType();
        if (BLOCKED_RESOURCE_TYPES.has(type)) {
          await route.abort('blockedbyclient');
          return;
        }
        if (!(await this.isRequestAllowed(requestUrl))) {
          this.logger.warn(
            `Blocked a subresource request from a rendered page: ${safeHost(requestUrl)}`,
          );
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      const page = await context.newPage();
      // A modal `alert()` blocks navigation forever otherwise.
      page.on('dialog', (dialog) => {
        void (dialog as { dismiss?: () => Promise<void> }).dismiss?.();
      });

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: budget,
        });
        // Hydration usually lands within a beat of DOMContentLoaded; this is a
        // bounded settle, never a "wait until idle" that a polling page could
        // extend indefinitely.
        await page.waitForTimeout(
          Math.min(1_500, Math.max(0, deadline - Date.now())),
        );
        const html = await page.content();
        const finalUrl = page.url();

        // Where the page ENDED UP is checked too: a client-side redirect is
        // still a navigation to somewhere we may not go.
        assertFetchableUrl(new URL(finalUrl));
        return { html, url: finalUrl };
      } catch (error) {
        if (error instanceof WebIngestionError) throw error;
        throw new WebIngestionError(
          LinkFailureCode.RENDER_FAILED,
          `Rendering failed: ${(error as Error).message}`,
        );
      } finally {
        await context.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /** Same gate as the static fetcher: URL policy first, then the real address. */
  private async isRequestAllowed(requestUrl: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(requestUrl);
    } catch {
      return false;
    }
    try {
      assertFetchableUrl(parsed);
    } catch {
      return false;
    }
    try {
      const dns = await import('node:dns');
      const addresses = await dns.promises.lookup(parsed.hostname, {
        all: true,
        verbatim: true,
      });
      return (
        addresses.length > 0 &&
        addresses.every((entry) => classifyAddress(entry.address).allowed)
      );
    } catch {
      return false;
    }
  }

  /**
   * Loads Playwright lazily. It is an OPTIONAL dependency: absent unless a
   * deployment installed it on purpose, so the require must not be static.
   */
  private async load(): Promise<PlaywrightLike> {
    if (this.playwright) return this.playwright;
    try {
      // Resolved through a variable so the compiler does not require the
      // package's types to be present: it is genuinely optional, and a static
      // import specifier would make the whole build depend on it.
      const moduleName = 'playwright';
      const loaded: unknown = await import(moduleName);
      this.playwright = loaded as PlaywrightLike;
      return this.playwright;
    } catch {
      throw new WebIngestionError(
        LinkFailureCode.RENDER_FAILED,
        'WEB_RENDER_ENABLED is set but the playwright package is not installed',
      );
    }
  }
}

/** Resource classes that carry no text and only cost time. */
const BLOCKED_RESOURCE_TYPES = new Set([
  'image',
  'media',
  'font',
  'stylesheet',
  'websocket',
  'eventsource',
  'manifest',
  'other',
]);

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '<unparseable>';
  }
}
