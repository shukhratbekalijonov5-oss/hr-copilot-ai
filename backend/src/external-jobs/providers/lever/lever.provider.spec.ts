import { ConfigService } from '@nestjs/config';
import {
  LeverProvider,
  clampPageSize,
  formatCursor,
  parseCursor,
} from './lever.provider';
import type { ProviderResponse } from '../../provider-http';

/**
 * The provider, exercised against captured response shapes.
 *
 * The pagination block is the important half. Lever pages with `skip`/`limit`
 * — OFFSET pagination over a live list — and the whole design question is what
 * that costs: a posting deleted mid-walk shifts every later one up by one, so
 * a posting can be silently skipped and then look absent. Absence is what
 * retires a job, so these tests pin exactly when this provider is willing to
 * claim it saw everything.
 */

const SITE_A = 'sitea';

function posting(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    text: `Role ${id}`,
    categories: {
      location: 'New York, New York',
      allLocations: ['New York, New York'],
    },
    country: 'US',
    workplaceType: 'onsite',
    descriptionPlain: 'We are hiring for a role on the New York team.',
    hostedUrl: `https://jobs.lever.co/${SITE_A}/${id}`,
    applyUrl: `https://jobs.lever.co/${SITE_A}/${id}/apply`,
    ...over,
  };
}

function config(sites: string, pageSize = 100): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => {
      if (key === 'externalJobs.leverSites') return sites;
      if (key === 'externalJobs.leverPageSize') return pageSize;
      return fallback;
    },
  } as unknown as ConfigService;
}

function provider(
  sites: string,
  handler: (url: string) => ProviderResponse | Promise<ProviderResponse>,
  pageSize = 100,
) {
  const calls: string[] = [];
  const instance = new LeverProvider(config(sites, pageSize), (url) => {
    calls.push(url);
    return Promise.resolve(handler(url));
  });
  return { provider: instance, calls };
}

function ok(payload: unknown): ProviderResponse {
  return {
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(payload)),
  };
}

function status(code: number, body = '{}'): ProviderResponse {
  return {
    status: code,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  };
}

/** Serve a site of `total` postings, honouring skip/limit like Lever does. */
function pagedSite(total: number) {
  return (url: string) => {
    const skip = Number(new URL(url).searchParams.get('skip') ?? 0);
    const limit = Number(new URL(url).searchParams.get('limit') ?? 100);
    const page = Array.from({ length: total }, (_, i) =>
      posting(`p${i}`),
    ).slice(skip, skip + limit);
    return ok(page);
  };
}

describe('LeverProvider', () => {
  describe('configuration', () => {
    it('is unconfigured with no sites, and makes no request', async () => {
      const { provider: lever, calls } = provider('', () => ok([]));
      expect(lever.configured).toBe(false);
      const page = await lever.fetchPage(null);
      expect(page.jobs).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('is configured once a site is listed', () => {
      expect(provider(SITE_A, () => ok([])).provider.configured).toBe(true);
    });

    it('declares the API host and only the API host', () => {
      // jobs.lever.co carries the posting and apply links, which are STORED
      // and shown but never fetched. api.eu.lever.co is deliberately absent:
      // this deployment calls no EU site.
      const { provider: lever } = provider(SITE_A, () => ok([]));
      expect(lever.descriptor.allowedHosts).toEqual(['api.lever.co']);
    });

    it('declares the official public API and conservative pacing', () => {
      const { provider: lever } = provider(SITE_A, () => ok([]));
      expect(lever.descriptor.provider).toBe('LEVER');
      expect(lever.descriptor.accessMethod).toBe('OFFICIAL_API');
      expect(lever.descriptor.maxConcurrency).toBe(1);
      expect(lever.descriptor.minRequestIntervalMs).toBeGreaterThan(0);
    });
  });

  describe('listing a site', () => {
    it('calls the documented public endpoint with no credential', async () => {
      const { provider: lever, calls } = provider(SITE_A, () =>
        ok([posting('p1')]),
      );
      await lever.fetchPage(null);
      expect(calls[0]).toContain('https://api.lever.co/v0/postings/sitea');
      expect(calls[0]).toContain('mode=json');
      expect(calls[0]).not.toMatch(/key=|secret|authorization|token=/i);
    });

    it('never touches the authenticated Lever API', async () => {
      const { provider: lever, calls } = provider(SITE_A, () => ok([]));
      await lever.fetchPage(null);
      const all = calls.join(' ');
      for (const surface of [
        'opportunities',
        'candidates',
        'requisitions',
        'interviews',
        'offers',
        '/v1/',
      ]) {
        expect(all).not.toContain(surface);
      }
    });

    it('normalizes every posting it can', async () => {
      const { provider: lever } = provider(SITE_A, () =>
        ok([posting('p1', { text: 'Staff Nurse' }), posting('p2')]),
      );
      const page = await lever.fetchPage(null);
      expect(page.jobs.map((job) => job.title)).toEqual([
        'Staff Nurse',
        'Role p2',
      ]);
      expect(page.scopeKey).toBe(SITE_A);
    });

    it('site-qualifies every source key', async () => {
      const { provider: lever } = provider(SITE_A, () => ok([posting('p1')]));
      const page = await lever.fetchPage(null);
      expect(page.jobs[0].sourceJobId).toBe('sitea:p1');
    });
  });

  describe('pagination', () => {
    it('requests a bounded page size', async () => {
      const { provider: lever, calls } = provider(SITE_A, pagedSite(10), 25);
      await lever.fetchPage(null);
      expect(calls[0]).toContain('limit=25');
      expect(calls[0]).toContain('skip=0');
    });

    it('walks a multi-page site by offset', async () => {
      const { provider: lever, calls } = provider(SITE_A, pagedSite(250), 100);
      let cursor: string | null = null;
      const seen: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const page = await lever.fetchPage(cursor);
        seen.push(...page.jobs.map((job) => job.sourceJobId!));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(250);
      expect(new Set(seen).size).toBe(250);
      expect(calls.map((url) => new URL(url).searchParams.get('skip'))).toEqual(
        ['0', '100', '200'],
      );
    });

    it('does not materialize the whole site in one request', async () => {
      const { provider: lever } = provider(SITE_A, pagedSite(250), 100);
      const page = await lever.fetchPage(null);
      expect(page.jobs).toHaveLength(100);
    });

    it('moves to the next site once a site runs short', async () => {
      const { provider: lever } = provider(
        `${SITE_A},siteb`,
        pagedSite(150),
        100,
      );
      const first = await lever.fetchPage(null);
      expect(first.nextCursor).toBe('sitea@100');
      const second = await lever.fetchPage(first.nextCursor);
      // 50 postings — short of the limit, so this site is done.
      expect(second.jobs).toHaveLength(50);
      expect(second.nextCursor).toBe('siteb');
    });

    it('ends the sweep after the last site', async () => {
      const { provider: lever } = provider(SITE_A, pagedSite(10), 100);
      expect((await lever.fetchPage(null)).nextCursor).toBeNull();
    });

    it('does not loop when a page returns exactly the limit and then nothing', async () => {
      const { provider: lever } = provider(SITE_A, pagedSite(100), 100);
      const first = await lever.fetchPage(null);
      expect(first.nextCursor).toBe('sitea@100');
      const second = await lever.fetchPage(first.nextCursor);
      expect(second.jobs).toHaveLength(0);
      expect(second.nextCursor).toBeNull();
    });

    it('ends the sweep if the cursor no longer names a configured site', async () => {
      const { provider: lever, calls } = provider(SITE_A, () => ok([]));
      const page = await lever.fetchPage('removed-from-config@0');
      expect(page.nextCursor).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('treats a malformed offset as the start of the site rather than trusting it', async () => {
      const { provider: lever, calls } = provider(SITE_A, pagedSite(10));
      await lever.fetchPage('sitea@notanumber');
      expect(calls[0]).toContain('skip=0');
    });
  });

  describe('completeness', () => {
    it('claims completeness when the whole site arrived in one request', async () => {
      // One atomic response: its absences are real.
      const { provider: lever } = provider(SITE_A, pagedSite(40), 100);
      expect((await lever.fetchPage(null)).complete).toBe(true);
    });

    it('refuses to claim completeness for a multi-page site', async () => {
      /*
       * The heart of the design. An offset walk over a live list can silently
       * skip a posting if one is deleted between pages — and that posting
       * would then look absent, which is what retires a job. So a paged site
       * never claims completeness and its jobs age to STALE instead.
       */
      const { provider: lever } = provider(SITE_A, pagedSite(250), 100);
      const first = await lever.fetchPage(null);
      expect(first.complete).toBe(false);
      const second = await lever.fetchPage(first.nextCursor);
      expect(second.complete).toBe(false);
      const third = await lever.fetchPage(second.nextCursor);
      expect(third.complete).toBe(false);
    });

    it('refuses completeness for any page after the first', async () => {
      const { provider: lever } = provider(SITE_A, pagedSite(120), 100);
      const second = await lever.fetchPage('sitea@100');
      expect(second.jobs).toHaveLength(20);
      // Short page, but reached by an offset walk — so it proves nothing.
      expect(second.complete).toBe(false);
    });

    it('claims completeness for an empty site', async () => {
      const { provider: lever } = provider(SITE_A, () => ok([]));
      expect((await lever.fetchPage(null)).complete).toBe(true);
    });
  });

  describe('malformed record isolation', () => {
    it('keeps every good posting when one is broken', async () => {
      const jobs = [
        ...Array.from({ length: 100 }, (_, i) => posting(`p${i}`)),
        { id: 'bad', text: 'Broken', hostedUrl: 'javascript:alert(1)' },
      ];
      const { provider: lever } = provider(SITE_A, () => ok(jobs), 200);
      const page = await lever.fetchPage(null);
      expect(page.jobs).toHaveLength(100);
      expect(page.rejected).toEqual([
        { sourceJobId: 'bad', reason: expect.any(String) },
      ]);
    });

    it('reports a rejection reason without the payload', async () => {
      const { provider: lever } = provider(SITE_A, () =>
        ok([
          {
            id: 'bad',
            text: 'Broken',
            hostedUrl: null,
            descriptionPlain: 'applicant@private.example',
          },
        ]),
      );
      const page = await lever.fetchPage(null);
      expect(page.rejected[0].reason).not.toContain('private.example');
    });

    it('survives a null entry inside the array', async () => {
      const { provider: lever } = provider(SITE_A, () =>
        ok([null, posting('p1')]),
      );
      const page = await lever.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
      expect(page.rejected).toHaveLength(1);
    });

    it('fails loudly when the listing is not an array', async () => {
      // Treating a shape change as "no postings" would look exactly like an
      // empty site, and an empty complete site retires everything.
      const { provider: lever } = provider(SITE_A, () =>
        ok({ ok: false, error: 'Document not found' }),
      );
      await expect(lever.fetchPage(null)).rejects.toThrow(/array of postings/);
    });
  });

  describe('upstream failures', () => {
    it.each([
      [500, /500/],
      [429, /rate limit/i],
      [404, /404/],
    ])(
      'propagates a %s so the run is not treated as complete',
      async (code, match) => {
        const { provider: lever } = provider(SITE_A, () => status(code));
        await expect(lever.fetchPage(null)).rejects.toThrow(match);
      },
    );

    it('propagates invalid JSON', async () => {
      const { provider: lever } = provider(SITE_A, () => ({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('not json at all'),
      }));
      await expect(lever.fetchPage(null)).rejects.toThrow(/not valid JSON/);
    });

    it('propagates a timeout', async () => {
      const { provider: lever } = provider(SITE_A, () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      });
      await expect(lever.fetchPage(null)).rejects.toThrow(/timed out/);
    });
  });

  describe('fetchOne', () => {
    it('re-reads one posting by site and id', async () => {
      const { provider: lever, calls } = provider(SITE_A, () =>
        ok(posting('p1', { text: 'Compounding Pharmacy Technician' })),
      );
      const result = await lever.fetchOne('sitea:p1');
      expect(result?.title).toBe('Compounding Pharmacy Technician');
      expect(calls[0]).toBe(
        'https://api.lever.co/v0/postings/sitea/p1?mode=json',
      );
    });

    it('returns null on 404 — evidence the posting is gone', async () => {
      const { provider: lever } = provider(SITE_A, () =>
        status(404, '{"ok":false,"error":"Document not found"}'),
      );
      await expect(lever.fetchOne('sitea:p1')).resolves.toBeNull();
    });

    it('throws on a 500 — which proves nothing about the posting', async () => {
      const { provider: lever } = provider(SITE_A, () => status(500));
      await expect(lever.fetchOne('sitea:p1')).rejects.toThrow();
    });

    it('refuses a key naming an unconfigured site', async () => {
      const { provider: lever, calls } = provider(SITE_A, () =>
        ok(posting('x')),
      );
      await expect(lever.fetchOne('someoneelse:p1')).resolves.toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('refuses an unqualified key', async () => {
      const { provider: lever, calls } = provider(SITE_A, () =>
        ok(posting('x')),
      );
      await expect(lever.fetchOne('p1')).resolves.toBeNull();
      expect(calls).toHaveLength(0);
    });
  });
});

describe('cursors', () => {
  it('round-trips a site and an offset', () => {
    expect(parseCursor(formatCursor('sitea', 200))).toEqual({
      slug: 'sitea',
      skip: 200,
    });
  });

  it('reads a bare site slug as offset zero', () => {
    expect(parseCursor('sitea')).toEqual({ slug: 'sitea', skip: 0 });
  });

  it('refuses a junk offset rather than coercing it', () => {
    // A silently-repaired cursor is how a sweep loops over page zero forever.
    for (const junk of ['sitea@-5', 'sitea@abc', 'sitea@1e9', 'sitea@']) {
      expect(parseCursor(junk)?.skip).toBe(0);
    }
  });

  it('is null for no cursor', () => {
    expect(parseCursor(null)).toBeNull();
  });
});

describe('clampPageSize', () => {
  it('bounds configuration in both directions', () => {
    expect(clampPageSize(100)).toBe(100);
    expect(clampPageSize(1)).toBe(10);
    expect(clampPageSize(100_000)).toBe(200);
    expect(clampPageSize(Number.NaN)).toBe(100);
  });
});
