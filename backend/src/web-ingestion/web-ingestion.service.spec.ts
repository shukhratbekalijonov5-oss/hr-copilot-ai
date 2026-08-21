import { LinkFailureCode } from '../generated/prisma/enums';
import { WebIngestionError } from './web-ingestion.errors';
import { WebIngestionService } from './web-ingestion.service';
import { PageRenderer, type RenderedPage } from './renderer';
import type { FetchedResource, SafeHttpFetcher } from './safe-fetcher';
import { assessContentQuality, isRenderable } from './content-quality';
import { extractEmbeddedJson } from './embedded-json';
import { discoverSubpages } from './subpage-discovery';
import { ALLOW_ALL, parseRobots } from './robots';
import { WEB_INGESTION_LIMITS } from './web-ingestion.limits';

const HOME = 'https://portfolio.example.com/';

/** A fetcher that answers from a URL → body map, recording what was asked for. */
function stubFetcher(pages: Record<string, string | Error>) {
  const requested: string[] = [];
  const fetcher = {
    requested,
    fetchText(url: string): Promise<FetchedResource> {
      requested.push(url);
      const body = pages[url];
      if (body === undefined) {
        return Promise.reject(
          new WebIngestionError(LinkFailureCode.ACCESS_DENIED, 'Upstream 404'),
        );
      }
      if (body instanceof Error) return Promise.reject(body);
      return Promise.resolve({
        url,
        status: 200,
        mediaType: url.endsWith('robots.txt') ? 'text/plain' : 'text/html',
        body,
        byteLength: body.length,
      });
    },
  };
  return fetcher as unknown as SafeHttpFetcher & { requested: string[] };
}

class NoRenderer extends PageRenderer {
  readonly available = false;
  render(): Promise<RenderedPage> {
    throw new Error('must not be called');
  }
}

class FakeRenderer extends PageRenderer {
  readonly available = true;
  calls = 0;
  constructor(private readonly html: string) {
    super();
  }
  render(url: string): Promise<RenderedPage> {
    this.calls += 1;
    return Promise.resolve({ html: this.html, url });
  }
}

/**
 * A page with enough real prose to clear the meaningful-content floor. The
 * padding sentence is deliberate: a fixture that sat just above the threshold
 * would make these tests fragile against an unrelated wording change.
 */
const richPage = (heading: string, body: string) =>
  `<html><head><title>Ji-woo Han</title></head><body><main>
     <h2>${heading}</h2><p>${body}</p>
     <p>Everything described here was built with a small team over several
        years, and the write-ups go into the trade-offs behind each decision
        rather than just the end result.</p></main></body></html>`;

// Comfortably over the 200-character meaningful-content floor, as a real
// "About" paragraph is. A fixture that sat just under it would make these
// tests pass or fail on the fixture rather than on the behaviour.
const ABOUT_TEXT =
  'Backend engineer in Seoul working on distributed logistics systems, ' +
  'event-driven architecture and the deployment tooling around them. ' +
  'I care about making releases boring and observable, and most of my ' +
  'public work is about the plumbing between a commit and a running ' +
  'service that people depend on every day.';

describe('WebIngestionService', () => {
  it('turns a normal page into normalized sections', async () => {
    const service = new WebIngestionService(
      stubFetcher({ [HOME]: richPage('About', ABOUT_TEXT) }),
      new NoRenderer(),
    );

    const result = await service.ingest(HOME);

    expect(result.fetchMode).toBe('STATIC');
    expect(result.pagesFetched).toBe(1);
    expect(result.title).toBe('Ji-woo Han');
    expect(result.sections[0].name).toBe('summary');
    expect(result.sections[0].url).toBe(HOME);
    expect(result.charCount).toBeGreaterThan(0);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a stable hash for identical content and a new one when it changes', async () => {
    const first = await new WebIngestionService(
      stubFetcher({ [HOME]: richPage('About', ABOUT_TEXT) }),
      new NoRenderer(),
    ).ingest(HOME);
    const same = await new WebIngestionService(
      stubFetcher({ [HOME]: richPage('About', ABOUT_TEXT) }),
      new NoRenderer(),
    ).ingest(HOME);
    const changed = await new WebIngestionService(
      stubFetcher({
        [HOME]: richPage('About', `${ABOUT_TEXT} Now with Rust.`),
      }),
      new NoRenderer(),
    ).ingest(HOME);

    expect(same.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it('records the detected type for display', async () => {
    const service = new WebIngestionService(
      stubFetcher({
        'https://github.com/jiwoo': richPage('deploy-tools', ABOUT_TEXT),
      }),
      new NoRenderer(),
    );
    const result = await service.ingest('https://github.com/jiwoo');
    expect(result.detectedType).toBe('GITHUB');
  });

  describe('bounded subpage discovery', () => {
    it('reads a small set of same-origin professional pages', async () => {
      const service = new WebIngestionService(
        stubFetcher({
          [HOME]: `<html><body><main><h2>About</h2><p>${ABOUT_TEXT}</p>
             <a href="/projects">Projects</a>
             <a href="/about">About</a>
             <a href="https://github.com/elsewhere">GitHub</a>
             <a href="/blog/post-1">A post</a></main></body></html>`,
          'https://portfolio.example.com/projects': richPage(
            'Projects',
            'Built a Kubernetes deployment for a logistics dispatch service.',
          ),
          'https://portfolio.example.com/about': richPage(
            'About',
            'Eight years of backend work across logistics and marketplaces.',
          ),
        }),
        new NoRenderer(),
      );

      const result = await service.ingest(HOME);

      expect(result.pagesFetched).toBe(3);
      const urls = new Set(result.sections.map((section) => section.url));
      expect(urls).toContain('https://portfolio.example.com/projects');
      // Cross-origin links never become evidence.
      expect([...urls].every((url) => url.startsWith(HOME.slice(0, -1)))).toBe(
        true,
      );
    });

    it('does not fail the source when a subpage is broken', async () => {
      const service = new WebIngestionService(
        stubFetcher({
          [HOME]: `<html><body><main><h2>About</h2><p>${ABOUT_TEXT}</p>
             <a href="/projects">Projects</a></main></body></html>`,
          // /projects is absent → the stub rejects it.
        }),
        new NoRenderer(),
      );

      const result = await service.ingest(HOME);
      expect(result.pagesFetched).toBe(1);
      expect(result.sections.length).toBeGreaterThan(0);
    });

    it('never exceeds the page budget', async () => {
      const many = Array.from(
        { length: 20 },
        (_, i) => `<a href="/projects/${i}">p${i}</a>`,
      ).join('');
      const pages: Record<string, string> = {
        [HOME]: `<html><body><main><h2>About</h2><p>${ABOUT_TEXT}</p>${many}</main></body></html>`,
      };
      for (let i = 0; i < 20; i += 1) {
        pages[`https://portfolio.example.com/projects/${i}`] = richPage(
          'Projects',
          `Project ${i} description with enough words to pass the quality gate here.`,
        );
      }

      const result = await new WebIngestionService(
        stubFetcher(pages),
        new NoRenderer(),
      ).ingest(HOME);

      expect(result.pagesFetched).toBeLessThanOrEqual(
        WEB_INGESTION_LIMITS.maxPagesPerLink,
      );
    });
  });

  describe('robots.txt', () => {
    it('refuses a page the site disallows', async () => {
      const service = new WebIngestionService(
        stubFetcher({
          'https://portfolio.example.com/robots.txt':
            'User-agent: *\nDisallow: /',
          [HOME]: richPage('About', ABOUT_TEXT),
        }),
        new NoRenderer(),
      );

      await expect(service.ingest(HOME)).rejects.toMatchObject({
        code: LinkFailureCode.ACCESS_DENIED,
      });
    });

    it('proceeds when robots.txt is absent', async () => {
      const service = new WebIngestionService(
        stubFetcher({ [HOME]: richPage('About', ABOUT_TEXT) }),
        new NoRenderer(),
      );
      await expect(service.ingest(HOME)).resolves.toBeTruthy();
    });
  });

  describe('JavaScript-rendered pages', () => {
    const SHELL =
      '<html><body><div id="__next"></div>' +
      '<noscript>You need to enable JavaScript to run this app.</noscript>' +
      '</body></html>';

    it('recovers content from a hydration payload WITHOUT a browser', async () => {
      const payload = JSON.stringify({
        props: {
          pageProps: {
            about:
              'I am a backend engineer who has spent the last three years ' +
              'running Kubernetes clusters for a logistics platform in Seoul.',
            project:
              'Fleet Router handles roughly nine thousand requests per second ' +
              'across a forty node cluster with zero downtime deploys.',
          },
        },
      });
      const renderer = new FakeRenderer(
        '<html><body><p>rendered</p></body></html>',
      );
      const service = new WebIngestionService(
        stubFetcher({
          [HOME]:
            `<html><body><div id="__next"></div>` +
            `<script id="__NEXT_DATA__" type="application/json">${payload}</script>` +
            `</body></html>`,
        }),
        renderer,
      );

      const result = await service.ingest(HOME);

      expect(result.sections.map((s) => s.text).join(' ')).toContain(
        'Kubernetes clusters',
      );
      // The whole point: the cheap path worked, so no browser was started.
      expect(renderer.calls).toBe(0);
    });

    it('falls back to rendering when nothing else can read the page', async () => {
      const renderer = new FakeRenderer(
        richPage(
          'Projects',
          'Deployed a Kubernetes cluster for a dispatch service at scale.',
        ),
      );
      const service = new WebIngestionService(
        stubFetcher({ [HOME]: SHELL }),
        renderer,
      );

      const result = await service.ingest(HOME);

      expect(renderer.calls).toBe(1);
      expect(result.fetchMode).toBe('RENDERED');
      expect(result.sections[0].text).toContain('Kubernetes cluster');
    });

    it('fails honestly when rendering is not enabled', async () => {
      const service = new WebIngestionService(
        stubFetcher({ [HOME]: SHELL }),
        new NoRenderer(),
      );

      await expect(service.ingest(HOME)).rejects.toMatchObject({
        code: LinkFailureCode.NO_MEANINGFUL_CONTENT,
      });
    });

    it('never renders an access wall — that would be working around it', async () => {
      const renderer = new FakeRenderer(richPage('About', ABOUT_TEXT));
      const service = new WebIngestionService(
        stubFetcher({
          [HOME]:
            '<html><body><main><h1>Sign in to continue</h1>' +
            '<p>Log in to view this profile.</p></main></body></html>',
        }),
        renderer,
      );

      await expect(service.ingest(HOME)).rejects.toMatchObject({
        code: LinkFailureCode.ACCESS_DENIED,
      });
      expect(renderer.calls).toBe(0);
    });

    it('does not render discovered subpages', async () => {
      // The fallback is for the page a person deliberately submitted, not for
      // every page a crawl happens to find.
      const renderer = new FakeRenderer(richPage('About', ABOUT_TEXT));
      const service = new WebIngestionService(
        stubFetcher({
          [HOME]: `<html><body><main><h2>About</h2><p>${ABOUT_TEXT}</p>
             <a href="/projects">Projects</a></main></body></html>`,
          'https://portfolio.example.com/projects': SHELL,
        }),
        renderer,
      );

      const result = await service.ingest(HOME);
      expect(renderer.calls).toBe(0);
      expect(result.pagesFetched).toBe(1);
    });
  });

  it('deduplicates text repeated across pages of the same site', async () => {
    const shared =
      'Available for backend engineering work in Seoul and remotely across Asia.';
    const service = new WebIngestionService(
      stubFetcher({
        [HOME]: `<html><body><main><h2>About</h2><p>${ABOUT_TEXT}</p>
           <p>${shared}</p><a href="/projects">Projects</a></main></body></html>`,
        'https://portfolio.example.com/projects': `<html><body><main>
           <h2>Projects</h2><p>Kubernetes deployment for a dispatch service.</p>
           <p>${shared}</p></main></body></html>`,
      }),
      new NoRenderer(),
    );

    const result = await service.ingest(HOME);
    const occurrences = result.sections.filter((section) =>
      section.text.includes(shared),
    ).length;
    expect(occurrences).toBe(1);
  });
});

describe('assessContentQuality', () => {
  const section = (text: string) => [{ text }];

  it('accepts a real page', () => {
    expect(assessContentQuality(section(ABOUT_TEXT))).toEqual({ ok: true });
  });

  it.each([
    ['', 'too-short'],
    ['Hello.', 'too-short'],
    ['You need to enable JavaScript to run this app.', 'javascript-shell'],
    ['Sign in to continue to this profile page.', 'access-wall'],
    ['404 Not Found', 'error-page'],
    ['Checking your browser before accessing the site.', 'access-wall'],
  ])('rejects %j as %s', (text, reason) => {
    expect(assessContentQuality(section(text))).toEqual({ ok: false, reason });
  });

  it('rejects navigation-only text that survived extraction', () => {
    // Long enough to clear the size floor, so this genuinely exercises the
    // "lots of lines, no sentences" rule rather than the length one.
    const menu = [
      'Home',
      'About the studio',
      'Work',
      'Blog archive',
      'Contact us',
      'Hire me today',
      'Resume download',
      'Selected projects',
      'Archive',
      'Privacy policy',
      'Terms of service',
      'Cookie preferences',
      'Newsletter signup',
      'Follow on social',
      'Back to top',
    ].join('\n');
    expect(assessContentQuality(section(menu))).toEqual({
      ok: false,
      reason: 'boilerplate-only',
    });
  });

  it('does not reject a long page that merely mentions a wall phrase', () => {
    const page = `${ABOUT_TEXT} ${'I once built a sign in to continue flow. '.repeat(45)}`;
    expect(assessContentQuality(section(page))).toEqual({ ok: true });
  });

  it('only treats thin pages as renderable', () => {
    expect(isRenderable('javascript-shell')).toBe(true);
    expect(isRenderable('too-short')).toBe(true);
    expect(isRenderable('access-wall')).toBe(false);
    expect(isRenderable('error-page')).toBe(false);
  });
});

describe('extractEmbeddedJson', () => {
  it('reads prose out of a Next.js data payload', () => {
    const payload = JSON.stringify({
      props: {
        bio: 'Backend engineer focused on deployment tooling and reliability work.',
        id: 'abc',
        url: 'https://example.com/x',
      },
    });
    const result = extractEmbeddedJson(
      `<script id="__NEXT_DATA__" type="application/json">${payload}</script>`,
    );
    expect(result.sections[0].text).toContain('deployment tooling');
    // Ids and URLs are machinery, not evidence.
    expect(result.sections[0].text).not.toContain('https://example.com/x');
  });

  it('reads a JSON-LD block', () => {
    const payload = JSON.stringify({
      '@type': 'Person',
      description:
        'Software engineer specialising in distributed systems and platform reliability.',
    });
    const result = extractEmbeddedJson(
      `<script type="application/ld+json">${payload}</script>`,
    );
    expect(result.sections[0].text).toContain('distributed systems');
  });

  it('ignores ordinary scripts so analytics keys never become evidence', () => {
    const result = extractEmbeddedJson(
      `<script>window.ANALYTICS_KEY = "a-very-long-secret-value-here-abcdef";</script>`,
    );
    expect(result.sections).toEqual([]);
  });

  it('survives malformed JSON without throwing', () => {
    expect(
      extractEmbeddedJson(
        `<script type="application/json">{not valid json</script>`,
      ).sections,
    ).toEqual([]);
  });
});

describe('discoverSubpages', () => {
  it('accepts professional same-origin paths only', () => {
    const found = discoverSubpages(HOME, [
      'https://portfolio.example.com/about',
      'https://portfolio.example.com/projects',
      'https://portfolio.example.com/privacy',
      'https://portfolio.example.com/a/b/c/deep',
      'https://portfolio.example.com/resume.pdf',
      'https://portfolio.example.com/projects?page=2',
      'https://other.example.com/about',
    ]);
    expect(found).toEqual([
      'https://portfolio.example.com/about',
      'https://portfolio.example.com/projects',
    ]);
  });

  it('never crawls GitHub', () => {
    expect(
      discoverSubpages('https://github.com/jiwoo', [
        'https://github.com/jiwoo/projects',
        'https://github.com/jiwoo?tab=repositories',
      ]),
    ).toEqual([]);
  });

  it('does not re-fetch the submitted page', () => {
    expect(
      discoverSubpages('https://portfolio.example.com/about', [
        'https://portfolio.example.com/about/',
        'https://portfolio.example.com/projects',
      ]),
    ).toEqual(['https://portfolio.example.com/projects']);
  });
});

describe('parseRobots', () => {
  const agent = 'HRCopilotLinkBot/1.0';

  it('honours a wildcard disallow', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /private/', agent);
    expect(policy.isAllowed('/private/x')).toBe(false);
    expect(policy.isAllowed('/projects')).toBe(true);
  });

  it('lets a more specific Allow win over a shorter Disallow', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /\nAllow: /projects',
      agent,
    );
    expect(policy.isAllowed('/projects/one')).toBe(true);
    expect(policy.isAllowed('/secrets')).toBe(false);
  });

  it('prefers a group naming this bot over the wildcard group', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: HRCopilotLinkBot\nDisallow:',
      agent,
    );
    expect(policy.isAllowed('/anything')).toBe(true);
  });

  it('supports * and $ wildcards', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /*.json$\nDisallow: /tmp*',
      agent,
    );
    expect(policy.isAllowed('/data.json')).toBe(false);
    expect(policy.isAllowed('/data.json.html')).toBe(true);
    expect(policy.isAllowed('/tmp-files/a')).toBe(false);
  });

  it('treats an empty or unparseable file as no rules', () => {
    expect(parseRobots('', agent).isAllowed('/x')).toBe(true);
    expect(parseRobots('total nonsense', agent).isAllowed('/x')).toBe(true);
    expect(ALLOW_ALL.isAllowed('/anything')).toBe(true);
  });
});
