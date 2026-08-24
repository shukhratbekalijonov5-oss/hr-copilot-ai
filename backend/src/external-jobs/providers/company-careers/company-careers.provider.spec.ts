import { ConfigService } from '@nestjs/config';
import { CompanyCareersProvider } from './company-careers.provider';
import { COMPANY_CAREERS_CATALOGUE } from './company-careers.catalogue';
import type { SafeHttpFetcher } from '../../../web-ingestion/safe-fetcher';
import type { CompanyCareerSource } from './company-careers.types';

/**
 * The provider as a whole: what it fetches, what it refuses, and what it
 * claims about completeness.
 *
 * The fetcher is faked, deliberately. `SafeHttpFetcher`'s own SSRF behaviour —
 * DNS classification, address pinning, per-hop policy — is proven against its
 * own tests, including the caller-allowlist hook this provider passes. What is
 * proven HERE is that the provider actually uses it, on every request, with
 * the allowlist attached, and after robots.txt has been consulted.
 */

interface Recorded {
  url: string;
  allowHost?: (url: URL) => boolean;
  userAgent?: string;
  maxBytes?: number;
}

function fakeFetcher(pages: Record<string, string | Error>): {
  fetcher: SafeHttpFetcher;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const fetcher = {
    fetchText: (url: string, options: Record<string, never>) => {
      const opts = options as unknown as Omit<Recorded, 'url'>;
      requests.push({ url, ...opts });
      // The provider's own allowlist, applied the way the real fetcher does.
      if (opts.allowHost && !opts.allowHost(new URL(url))) {
        return Promise.reject(new Error(`allowHost refused ${url}`));
      }
      const body = pages[url];
      if (body === undefined) {
        return Promise.reject(new Error(`404 for ${url}`));
      }
      if (body instanceof Error) return Promise.reject(body);
      return Promise.resolve({
        url,
        status: 200,
        mediaType: 'text/html',
        body,
        byteLength: body.length,
      });
    },
  };
  return { fetcher: fetcher as unknown as SafeHttpFetcher, requests };
}

/**
 * The reviewed entries, handed to the provider directly.
 *
 * Behaviour is tested against the REAL Vercel and Linear configurations —
 * their real hosts, paths, patterns and title suffixes — but independently of
 * whether those sources are switched on this week. The two questions are
 * different: "does the sitemap reader work" must keep being answered even
 * after an operational decision to stop reading a company, which is exactly
 * when the code is least exercised and most likely to rot.
 *
 * Whether configuration can turn one ON is a separate question, and the
 * catalogue spec answers it.
 */
function catalogueEntry(sourceId: string): CompanyCareerSource {
  return COMPANY_CAREERS_CATALOGUE.find(
    (source) => source.sourceId === sourceId,
  )!;
}

function build(
  sourceIds: string,
  pages: Record<string, string | Error>,
): {
  provider: CompanyCareersProvider;
  requests: Recorded[];
} {
  const { fetcher, requests } = fakeFetcher(pages);
  const config = {
    get: (key: string, fallback?: unknown) =>
      key === 'externalJobs.companyCareersSources' ? '' : fallback,
  } as unknown as ConfigService;
  const sources = sourceIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(catalogueEntry);
  // Pacing is real seconds otherwise, and this suite makes many requests.
  class Instant extends CompanyCareersProvider {
    protected override sleep(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { provider: new Instant(config, fetcher, sources), requests };
}

const ROBOTS_OPEN = 'User-agent: *\nDisallow: /api/\n';

const LINEAR_INDEX = `<html><body>
  <a href="/pricing">Pricing</a>
  <a href="/careers/069c4628-88d7-4e4d-b393-c996fc7f3076"><span>Account Executive, Enterprise</span><span>North America</span></a>
  <a href="/careers/453f1ba0-a35e-4ed2-8215-1514e0a30b92"><span>Product Engineer</span><span>Remote</span></a>
</body></html>`;

const linearJob = (id: string, title: string) => `<html><head>
  <meta property="og:title" content="${title} - Linear Careers"/>
  <meta property="og:url" content="https://linear.app/careers/${id}"/>
</head><body>
  <a href="https://jobs.ashbyhq.com/Linear/${id}">Apply now</a>
</body></html>`;

const LINEAR_PAGES: Record<string, string> = {
  'https://linear.app/robots.txt': ROBOTS_OPEN,
  'https://linear.app/careers': LINEAR_INDEX,
  'https://linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076': linearJob(
    '069c4628-88d7-4e4d-b393-c996fc7f3076',
    'Account Executive, Enterprise',
  ),
  'https://linear.app/careers/453f1ba0-a35e-4ed2-8215-1514e0a30b92': linearJob(
    '453f1ba0-a35e-4ed2-8215-1514e0a30b92',
    'Product Engineer',
  ),
};

describe('registration', () => {
  it('is unconfigured with no approved sources', () => {
    const { provider } = build('', {});
    expect(provider.configured).toBe(false);
    // Nothing to fetch, so no host is declared and the registry skips it.
    expect(provider.descriptor.allowedHosts).toEqual([]);
  });

  it('declares only the hosts its sources named', () => {
    const { provider } = build('linear-careers', LINEAR_PAGES);
    expect(provider.configured).toBe(true);
    expect(provider.descriptor.allowedHosts).toEqual(['linear.app']);
  });

  it('is unconfigured when every configured id was reviewed off', () => {
    // Through the CONFIG path, which is the one an operator can reach.
    const { fetcher } = fakeFetcher({});
    const provider = new CompanyCareersProvider(
      {
        get: (key: string, fallback?: unknown) =>
          key === 'externalJobs.companyCareersSources'
            ? 'figma-careers,ramp-careers,vercel-careers,linear-careers'
            : fallback,
      } as unknown as ConfigService,
      fetcher,
    );
    expect(provider.configured).toBe(false);
  });
});

describe('reading an anchor-list source', () => {
  it('finds the jobs, follows their pages and stores the apply link', async () => {
    const { provider, requests } = build('linear-careers', LINEAR_PAGES);
    const page = await provider.fetchPage(null);

    expect(page.scopeKey).toBe('linear-careers');
    expect(page.jobs).toHaveLength(2);
    const [first] = page.jobs;
    expect(first.title).toBe('Account Executive, Enterprise');
    expect(first.sourceUrl).toBe(
      'https://linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076',
    );
    expect(first.originalUrl).toBe(
      'https://jobs.ashbyhq.com/Linear/069c4628-88d7-4e4d-b393-c996fc7f3076',
    );
    expect(first.provider).toBe('COMPANY_CAREERS');

    // The ATS was linked to, never fetched.
    expect(requests.map((request) => request.url)).not.toContain(
      'https://jobs.ashbyhq.com/Linear/069c4628-88d7-4e4d-b393-c996fc7f3076',
    );
  });

  it('ignores links that are not job pages', async () => {
    const { provider, requests } = build('linear-careers', LINEAR_PAGES);
    await provider.fetchPage(null);
    expect(requests.map((request) => request.url)).not.toContain(
      'https://linear.app/pricing',
    );
  });

  it('never claims completeness for a source whose index is not complete', async () => {
    /*
     * Linear's page renders one row per TITLE and seven titles are open twice,
     * so an absence here is not evidence a posting stopped being published.
     * With complete=false the sync cannot retire anything for this source.
     */
    const { provider } = build('linear-careers', LINEAR_PAGES);
    expect((await provider.fetchPage(null)).complete).toBe(false);
  });

  it('is idempotent: the same page twice yields the same identities', async () => {
    const { provider } = build('linear-careers', LINEAR_PAGES);
    const first = await provider.fetchPage(null);
    const second = await provider.fetchPage(null);
    expect(second.jobs.map((job) => job.sourceJobId)).toEqual(
      first.jobs.map((job) => job.sourceJobId),
    );
  });
});

describe('reading a sitemap source', () => {
  const SITEMAP = `<urlset>
    <url><loc>https://vercel.com/careers/engineering-manager-cdn-5701765004</loc></url>
    <url><loc>https://vercel.com/careers/software-engineer-accounts-5430088004</loc></url>
    <url><loc>https://vercel.com/careers/software-engineer-backend-us-5430088004</loc></url>
    <url><loc>https://vercel.com/blog/not-a-job</loc></url>
    <url><loc>https://evil.test/careers/stolen</loc></url>
  </urlset>`;

  const vercelJob = (slug: string, id: string, title: string) =>
    [
      `<html><head><meta property="og:title" content="${title}"/>`,
      `<meta property="og:url" content="https://vercel.com/careers/${slug}"/>`,
      `</head><body><a href="https://job-boards.greenhouse.io/vercel/jobs/${id}">Apply</a></body></html>`,
    ].join('');

  const PAGES: Record<string, string> = {
    'https://vercel.com/robots.txt': ROBOTS_OPEN,
    'https://vercel.com/crawled-sitemap.xml': SITEMAP,
    'https://vercel.com/careers/engineering-manager-cdn-5701765004': vercelJob(
      'engineering-manager-cdn-5701765004',
      '5701765004',
      'Engineering Manager, CDN',
    ),
    'https://vercel.com/careers/software-engineer-accounts-5430088004':
      vercelJob(
        'software-engineer-accounts-5430088004',
        '5430088004',
        'Software Engineer, Accounts',
      ),
    'https://vercel.com/careers/software-engineer-backend-us-5430088004':
      vercelJob(
        'software-engineer-backend-us-5430088004',
        '5430088004',
        'Software Engineer, Backend',
      ),
  };

  it('reads only the job paths the source declared', async () => {
    const { provider, requests } = build('vercel-careers', PAGES);
    const page = await provider.fetchPage(null);

    expect(page.jobs).toHaveLength(3);
    const fetched = requests.map((request) => request.url);
    expect(fetched).not.toContain('https://vercel.com/blog/not-a-job');
  });

  it("never leaves the source's own host, whatever the sitemap says", async () => {
    // A sitemap is a third-party document. An entry pointing elsewhere is not
    // an instruction.
    const { provider, requests } = build('vercel-careers', PAGES);
    await provider.fetchPage(null);
    for (const request of requests) {
      expect(new URL(request.url).hostname).toBe('vercel.com');
    }
  });

  it('keeps three company URLs that carry ONE requisition as three sightings', async () => {
    /*
     * Live: Vercel publishes three careers URLs whose apply links are all
     * Greenhouse requisition 5430088004. They are three published pages —
     * three source rows — and the dedupe layer merges them into one canonical
     * job on the shared apply URL. Collapsing them here would throw away the
     * fact that the employer publishes all three.
     */
    const { provider } = build('vercel-careers', PAGES);
    const page = await provider.fetchPage(null);
    const sharing = page.jobs.filter((job) =>
      job.originalUrl?.endsWith('/5430088004'),
    );
    expect(sharing).toHaveLength(2);
    expect(new Set(sharing.map((job) => job.sourceJobId)).size).toBe(2);
  });

  it('is never complete: a sitemap lags the site it describes', async () => {
    const { provider } = build('vercel-careers', PAGES);
    expect((await provider.fetchPage(null)).complete).toBe(false);
  });

  it('refuses to follow a sitemap INDEX', async () => {
    const { provider } = build('vercel-careers', {
      'https://vercel.com/robots.txt': ROBOTS_OPEN,
      'https://vercel.com/crawled-sitemap.xml':
        '<sitemapindex><sitemap><loc>https://vercel.com/sitemap/jobs.xml</loc></sitemap></sitemapindex>',
    });
    await expect(provider.fetchPage(null)).rejects.toThrow(/sitemap index/i);
  });
});

describe('robots.txt is consulted before anything is fetched', () => {
  it('refuses a path the site disallows', async () => {
    const { provider, requests } = build('linear-careers', {
      ...LINEAR_PAGES,
      'https://linear.app/robots.txt': 'User-agent: *\nDisallow: /careers\n',
    });

    // The index itself is disallowed, so the whole source fails — and a
    // failing source retires nothing.
    await expect(provider.fetchPage(null)).rejects.toThrow(/robots\.txt/i);
    expect(requests.map((request) => request.url)).toEqual([
      'https://linear.app/robots.txt',
    ]);
  });

  it('honours a rule addressed at this bot specifically', async () => {
    const { provider } = build('linear-careers', {
      ...LINEAR_PAGES,
      'https://linear.app/robots.txt': [
        'User-agent: *',
        'Allow: /',
        '',
        `User-agent: ${CompanyCareersProvider.ROBOTS_TOKEN}`,
        'Disallow: /careers',
      ].join('\n'),
    });
    await expect(provider.fetchPage(null)).rejects.toThrow(/robots\.txt/i);
  });

  it('treats a missing robots.txt as no rules stated', async () => {
    // The absence of a policy is not a prohibition.
    const pages = { ...LINEAR_PAGES };
    delete (pages as Record<string, string>)['https://linear.app/robots.txt'];
    const { provider } = build('linear-careers', pages);
    expect((await provider.fetchPage(null)).jobs).toHaveLength(2);
  });

  it('fetches robots.txt once per host, not once per page', async () => {
    const { provider, requests } = build('linear-careers', LINEAR_PAGES);
    await provider.fetchPage(null);
    await provider.fetchPage(null);
    const robotsCalls = requests.filter((request) =>
      request.url.endsWith('/robots.txt'),
    );
    expect(robotsCalls).toHaveLength(1);
  });
});

describe("every request carries the provider's guarantees", () => {
  it('names this bot, caps the body and pins the allowlist', async () => {
    const { provider, requests } = build('linear-careers', LINEAR_PAGES);
    await provider.fetchPage(null);

    for (const request of requests) {
      expect(request.userAgent).toBe(CompanyCareersProvider.USER_AGENT);
      expect(request.maxBytes).toBeLessThanOrEqual(
        CompanyCareersProvider.MAX_PAGE_BYTES,
      );
      expect(typeof request.allowHost).toBe('function');
    }
  });

  it('rejects an off-allowlist host through the hook it passes', async () => {
    const { provider, requests } = build('linear-careers', LINEAR_PAGES);
    await provider.fetchPage(null);
    const hook = requests.find((request) =>
      request.url.endsWith('/careers'),
    )!.allowHost!;

    // The same predicate the real fetcher applies to every redirect hop.
    expect(hook(new URL('https://linear.app/careers/x'))).toBe(true);
    expect(hook(new URL('https://evil.test/careers/x'))).toBe(false);
    expect(hook(new URL('https://linear.app.evil.test/careers/x'))).toBe(false);
    expect(hook(new URL('https://jobs.ashbyhq.com/Linear/x'))).toBe(false);
    expect(hook(new URL('https://linear.app/api/internal'))).toBe(false);
  });
});

describe('failure isolation', () => {
  it('loses one unreadable job page, not the source', async () => {
    // Vercel's sitemap lists roles that have since closed; a 404 on one is
    // routine and must not block the sweep for the rest.
    const pages: Record<string, string | Error> = { ...LINEAR_PAGES };
    pages['https://linear.app/careers/453f1ba0-a35e-4ed2-8215-1514e0a30b92'] =
      new Error('404');
    const { provider } = build('linear-careers', pages);

    const page = await provider.fetchPage(null);
    expect(page.jobs).toHaveLength(1);
    expect(page.rejected).toHaveLength(1);
  });

  it('fails the whole source when its INDEX cannot be read', async () => {
    const { provider } = build('linear-careers', {
      'https://linear.app/robots.txt': ROBOTS_OPEN,
      'https://linear.app/careers': new Error('502 Bad Gateway'),
    });
    // Propagates, so the run is FAILED and the absence sweep never runs.
    await expect(provider.fetchPage(null)).rejects.toThrow(/502/);
  });

  it('walks to the next source and ends the sweep', async () => {
    const { provider } = build('linear-careers,vercel-careers', LINEAR_PAGES);
    const first = await provider.fetchPage(null);
    expect(first.scopeKey).toBe('linear-careers');
    expect(first.nextCursor).toBe('vercel-careers');

    const stale = await provider.fetchPage('a-source-that-was-removed');
    expect(stale.jobs).toEqual([]);
    expect(stale.nextCursor).toBeNull();
  });
});

describe('bounded work', () => {
  it('stops at the per-sync job cap and refuses to claim completeness', async () => {
    const many = Array.from({ length: 20 }, (_, index) => {
      const id = `${index}`.padStart(8, '0') + '-0000-0000-0000-000000000000';
      return { id, title: `Engineer ${index}` };
    });
    const pages: Record<string, string> = {
      'https://linear.app/robots.txt': ROBOTS_OPEN,
      'https://linear.app/careers': `<html><body>${many
        .map(
          (job) => `<a href="/careers/${job.id}"><span>${job.title}</span></a>`,
        )
        .join('')}</body></html>`,
    };
    for (const job of many) {
      pages[`https://linear.app/careers/${job.id}`] = linearJob(
        job.id,
        job.title,
      );
    }

    const { provider } = build('linear-careers', pages);
    // Force the cap without editing the reviewed catalogue.
    const source = provider.enabledSources[0];
    Object.assign(source, { maxJobsPerSync: 5, maxDetailRequests: 5 });

    const page = await provider.fetchPage(null);
    expect(page.jobs).toHaveLength(5);
    // A listing cut short is a partial listing, and must never retire.
    expect(page.complete).toBe(false);

    Object.assign(source, { maxJobsPerSync: 100, maxDetailRequests: 60 });
  });
});
