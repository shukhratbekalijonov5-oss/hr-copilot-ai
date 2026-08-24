import { ConfigService } from '@nestjs/config';
import { AshbyProvider } from './ashby.provider';
import type { ProviderResponse } from '../../provider-http';

/**
 * The provider, exercised against captured response shapes.
 *
 * The `isListed` block is the important half. Ashby is the first provider that
 * returns postings it does not want listed publicly, and a job board that
 * shows them anyway has published something the employer deliberately
 * unpublished.
 */

const BOARD = 'exampleboard';

function posting(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Role ${id}`,
    employmentType: 'FullTime',
    workplaceType: 'Hybrid',
    isRemote: true,
    isListed: true,
    location: 'San Francisco',
    address: {
      postalAddress: {
        addressLocality: 'San Francisco',
        addressRegion: 'California',
        addressCountry: 'USA',
      },
    },
    descriptionPlain: 'We are hiring for a role on the San Francisco team.',
    jobUrl: `https://jobs.ashbyhq.com/${BOARD}/${id}`,
    applyUrl: `https://jobs.ashbyhq.com/${BOARD}/${id}/application`,
    ...over,
  };
}

function config(boards: string): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'externalJobs.ashbyBoards' ? boards : fallback,
  } as unknown as ConfigService;
}

function provider(
  boards: string,
  handler: (url: string) => ProviderResponse | Promise<ProviderResponse>,
) {
  const calls: string[] = [];
  const instance = new AshbyProvider(config(boards), (url) => {
    calls.push(url);
    return Promise.resolve(handler(url));
  });
  return { provider: instance, calls };
}

function board(jobs: unknown[], apiVersion: unknown = 1): ProviderResponse {
  return {
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify({ apiVersion, jobs })),
  };
}

function status(code: number, body = '{}'): ProviderResponse {
  return {
    status: code,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  };
}

describe('AshbyProvider', () => {
  describe('configuration', () => {
    it('is unconfigured with no boards, and makes no request', async () => {
      const { provider: ashby, calls } = provider('', () => board([]));
      expect(ashby.configured).toBe(false);
      expect((await ashby.fetchPage(null)).jobs).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('is configured once a board is listed', () => {
      expect(provider(BOARD, () => board([])).provider.configured).toBe(true);
    });

    it('declares the API host and only the API host', () => {
      // jobs.ashbyhq.com carries the posting and apply links, which are STORED
      // and shown but never fetched.
      const { provider: ashby } = provider(BOARD, () => board([]));
      expect(ashby.descriptor.allowedHosts).toEqual(['api.ashbyhq.com']);
    });

    it('declares the official public API and conservative pacing', () => {
      const { provider: ashby } = provider(BOARD, () => board([]));
      expect(ashby.descriptor.provider).toBe('ASHBY');
      expect(ashby.descriptor.accessMethod).toBe('OFFICIAL_API');
      expect(ashby.descriptor.maxConcurrency).toBe(1);
      expect(ashby.descriptor.minRequestIntervalMs).toBeGreaterThan(0);
    });
  });

  describe('listing a board', () => {
    it('calls the documented public endpoint with no credential', async () => {
      const { provider: ashby, calls } = provider(BOARD, () =>
        board([posting('p1')]),
      );
      await ashby.fetchPage(null);
      expect(calls[0]).toBe(
        'https://api.ashbyhq.com/posting-api/job-board/exampleboard?includeCompensation=true',
      );
      expect(calls[0]).not.toMatch(/key=|secret|authorization|token=/i);
    });

    it('never touches the authenticated RPC API', async () => {
      const { provider: ashby, calls } = provider(BOARD, () => board([]));
      await ashby.fetchPage(null);
      const all = calls.join(' ');
      for (const surface of [
        'jobPosting.list',
        'jobPosting.info',
        'job.list',
        'candidate',
        'application',
        'offer',
        'interview',
      ]) {
        expect(all).not.toContain(surface);
      }
    });

    it('normalizes every listed posting', async () => {
      const { provider: ashby } = provider(BOARD, () =>
        board([posting('p1', { title: 'Staff Nurse' }), posting('p2')]),
      );
      const page = await ashby.fetchPage(null);
      expect(page.jobs.map((job) => job.title)).toEqual([
        'Staff Nurse',
        'Role p2',
      ]);
      expect(page.scopeKey).toBe(BOARD);
    });

    it('board-qualifies every source key', async () => {
      const { provider: ashby } = provider(BOARD, () => board([posting('p1')]));
      const page = await ashby.fetchPage(null);
      expect(page.jobs[0].sourceJobId).toBe('exampleboard:p1');
    });

    it('reads a board regardless of the apiVersion it reports', async () => {
      const { provider: ashby } = provider(BOARD, () =>
        board([posting('p1')], 2),
      );
      expect((await ashby.fetchPage(null)).jobs).toHaveLength(1);
    });
  });

  describe('isListed', () => {
    it('drops unlisted postings before they reach ingestion', async () => {
      /*
       * The rule that makes Ashby different. `isListed: false` means reachable
       * by direct link but not to be shown in a public listing, so a job board
       * that shows it anyway publishes what the employer unpublished.
       */
      const { provider: ashby } = provider(BOARD, () =>
        board([
          posting('p1'),
          posting('p2', { isListed: false }),
          posting('p3'),
        ]),
      );
      const page = await ashby.fetchPage(null);
      expect(page.jobs.map((job) => job.sourceJobId)).toEqual([
        'exampleboard:p1',
        'exampleboard:p3',
      ]);
    });

    it('does not count an unlisted posting as a rejection', async () => {
      // It was seen and deliberately excluded, which is a decision rather than
      // a failure — counting it as one would make every run PARTIAL.
      const { provider: ashby } = provider(BOARD, () =>
        board([posting('p1'), posting('p2', { isListed: false })]),
      );
      const page = await ashby.fetchPage(null);
      expect(page.rejected).toEqual([]);
    });

    it('still reports the snapshot as complete', async () => {
      // Excluding unlisted postings is not a gap in what was observed, so
      // absence remains actionable and a delisted job can be retired.
      const { provider: ashby } = provider(BOARD, () =>
        board([posting('p1', { isListed: false })]),
      );
      const page = await ashby.fetchPage(null);
      expect(page.complete).toBe(true);
      expect(page.jobs).toEqual([]);
    });

    it('keeps a posting that omits the flag entirely', async () => {
      // Only an explicit false excludes; a missing flag is not a delisting.
      const { provider: ashby } = provider(BOARD, () =>
        board([posting('p1', { isListed: undefined })]),
      );
      expect((await ashby.fetchPage(null)).jobs).toHaveLength(1);
    });
  });

  describe('completeness', () => {
    it('treats a well-formed single response as a complete snapshot', async () => {
      const { provider: ashby, calls } = provider(BOARD, () =>
        board([posting('p1'), posting('p2')]),
      );
      const page = await ashby.fetchPage(null);
      expect(page.complete).toBe(true);
      // The endpoint documents no pagination and returns the whole board.
      expect(calls).toHaveLength(1);
    });

    it('treats an empty board as complete', async () => {
      expect(
        (await provider(BOARD, () => board([])).provider.fetchPage(null))
          .complete,
      ).toBe(true);
    });

    it('fails loudly when the response has no jobs array', async () => {
      // Treating a shape change as an empty board would retire everything on
      // it, because an empty COMPLETE board means "nothing is listed".
      const { provider: ashby } = provider(BOARD, () => ({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ apiVersion: 1 })),
      }));
      await expect(ashby.fetchPage(null)).rejects.toThrow(/jobs array/);
    });

    it('never reports completeness for a failed request', async () => {
      const { provider: ashby } = provider(BOARD, () => status(500));
      await expect(ashby.fetchPage(null)).rejects.toThrow(/500/);
    });
  });

  describe('walking boards', () => {
    it('returns the next board as the cursor and ends on the last', async () => {
      const { provider: ashby } = provider(`${BOARD},otherboard`, () =>
        board([]),
      );
      expect((await ashby.fetchPage(null)).nextCursor).toBe('otherboard');
      expect((await ashby.fetchPage('otherboard')).nextCursor).toBeNull();
    });

    it('fetches one board per page', async () => {
      const { provider: ashby, calls } = provider(
        `${BOARD},otherboard,third`,
        () => board([]),
      );
      await ashby.fetchPage(null);
      expect(calls).toHaveLength(1);
    });

    it('ends the sweep if the cursor no longer names a configured board', async () => {
      const { provider: ashby, calls } = provider(BOARD, () => board([]));
      const page = await ashby.fetchPage('removed-from-config');
      expect(page.nextCursor).toBeNull();
      expect(calls).toHaveLength(0);
    });
  });

  describe('malformed record isolation', () => {
    it('keeps every good posting when one is broken', async () => {
      const jobs = [
        ...Array.from({ length: 100 }, (_, i) => posting(`p${i}`)),
        { id: 'bad', title: 'Broken', jobUrl: 'javascript:alert(1)' },
      ];
      const { provider: ashby } = provider(BOARD, () => board(jobs));
      const page = await ashby.fetchPage(null);
      expect(page.jobs).toHaveLength(100);
      expect(page.rejected).toEqual([
        { sourceJobId: 'bad', reason: expect.any(String) },
      ]);
    });

    it('reports a rejection reason without the payload', async () => {
      const { provider: ashby } = provider(BOARD, () =>
        board([
          {
            id: 'bad',
            title: 'Broken',
            jobUrl: null,
            descriptionPlain: 'applicant@private.example',
          },
        ]),
      );
      const page = await ashby.fetchPage(null);
      expect(page.rejected[0].reason).not.toContain('private.example');
    });

    it('survives a null entry inside the array', async () => {
      const { provider: ashby } = provider(BOARD, () =>
        board([null, posting('p1')]),
      );
      const page = await ashby.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
      expect(page.rejected).toHaveLength(1);
    });
  });

  describe('upstream failures', () => {
    it.each([
      [500, /500/],
      [429, /rate limit/i],
      [404, /404/],
    ])('propagates a %s', async (code, match) => {
      const { provider: ashby } = provider(BOARD, () => status(code));
      await expect(ashby.fetchPage(null)).rejects.toThrow(match);
    });

    it('propagates invalid JSON', async () => {
      const { provider: ashby } = provider(BOARD, () => ({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('not json at all'),
      }));
      await expect(ashby.fetchPage(null)).rejects.toThrow(/not valid JSON/);
    });

    it('propagates a timeout', async () => {
      const { provider: ashby } = provider(BOARD, () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      });
      await expect(ashby.fetchPage(null)).rejects.toThrow(/timed out/);
    });
  });

  describe('fetchOne', () => {
    it('finds one posting in its board', async () => {
      const { provider: ashby } = provider(BOARD, () =>
        board([posting('p1'), posting('p2', { title: 'Corporate Counsel' })]),
      );
      const result = await ashby.fetchOne('exampleboard:p2');
      expect(result?.title).toBe('Corporate Counsel');
    });

    it('returns null once a posting is unlisted — evidence the source is gone', async () => {
      const { provider: ashby } = provider(BOARD, () =>
        board([posting('p1', { isListed: false })]),
      );
      await expect(ashby.fetchOne('exampleboard:p1')).resolves.toBeNull();
    });

    it('returns null when the posting has disappeared', async () => {
      const { provider: ashby } = provider(BOARD, () => board([posting('p9')]));
      await expect(ashby.fetchOne('exampleboard:p1')).resolves.toBeNull();
    });

    it('throws on a 500 — which proves nothing about the posting', async () => {
      const { provider: ashby } = provider(BOARD, () => status(500));
      await expect(ashby.fetchOne('exampleboard:p1')).rejects.toThrow();
    });

    it('refuses a key naming an unconfigured board', async () => {
      const { provider: ashby, calls } = provider(BOARD, () =>
        board([posting('p1')]),
      );
      await expect(ashby.fetchOne('someoneelse:p1')).resolves.toBeNull();
      expect(calls).toHaveLength(0);
    });
  });
});
