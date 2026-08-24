import { ConfigService } from '@nestjs/config';
import {
  NinehireProvider,
  clampPageSize,
  formatCursor,
  parseCursor,
} from './ninehire.provider';
import { parseNinehireSources } from './ninehire.sources';
import type { ProviderResponse } from '../../provider-http';

/**
 * The provider, exercised against the officially documented shapes.
 *
 * Ninehire is the first AUTHENTICATED provider, so the credential-handling
 * block matters more than anything else here: a key that leaks into a log
 * line, a queue payload or a redirected request is a compromise of somebody
 * else's recruiting workspace.
 *
 * No test performs a real request. There is no authorized credential
 * configured, and fabricating one to reach a live workspace would be exactly
 * the unauthorized access this provider is built to make impossible.
 */

/** Obvious dummy. Never a real key, never valid anywhere. */
const FAKE_KEY = 'test-not-a-real-key-0000';

function posting(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `채용 ${id}`,
    applyUrl: `https://career.ninehire.com/job_posting/${id}/apply`,
    deadline: null,
    tags: [],
    career: 'irrelevant',
    employmentTypes: ['full_time'],
    careerRange: null,
    jobLocations: [
      {
        x: 129.12,
        y: 35.17,
        name: '부산지사',
        address: '부산 해운대구 센텀중앙로 97',
      },
    ],
    jobGroup: '개발팀',
    jobTask: '프론트엔드',
    affiliation: '나인하이어',
    createdAt: '2026-01-05T00:00:00.000Z',
    isPrivate: false,
    status: 'in_progress',
    ...over,
  };
}

function config(
  sources: string,
  env: Record<string, unknown> = { NINEHIRE_KEY_ACME: FAKE_KEY },
): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => {
      if (key === 'externalJobs.ninehireSources') return sources;
      if (key in env) return env[key];
      return fallback;
    },
  } as unknown as ConfigService;
}

interface Call {
  url: string;
  headers: Record<string, string>;
}

function provider(
  sources: string,
  handler: (url: string) => ProviderResponse | Promise<ProviderResponse>,
  env?: Record<string, unknown>,
) {
  const calls: Call[] = [];
  const waits: number[] = [];
  const instance = new NinehireProvider(
    config(sources, env),
    (url, init) => {
      calls.push({ url, headers: init.headers });
      return Promise.resolve(handler(url));
    },
    // The 60/minute gate is asserted, not slept through.
    (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  );
  return { provider: instance, calls, waits };
}

function list(results: unknown[], count = results.length): ProviderResponse {
  return {
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify({ count, results })),
  };
}

function detail(job: unknown): ProviderResponse {
  return {
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(job)),
  };
}

function status(code: number, body = '{}'): ProviderResponse {
  return {
    status: code,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  };
}

/** The posting id from a detail URL. */
function idFromUrl(url: string): string {
  return url.split('/jobs/')[1].split('?')[0];
}

/** Serve the list, and a detail body for any /jobs/{id} call. */
function workspace(results: unknown[], content = '<p>상세 내용</p>') {
  return (url: string) => {
    if (/\/jobs\/[^?]+/.test(url)) {
      return detail({ ...posting(idFromUrl(url)), content });
    }
    return list(results);
  };
}

describe('parseNinehireSources', () => {
  const cfg = config('', { NINEHIRE_KEY_ACME: FAKE_KEY });

  it('reads scope and secret reference', () => {
    const sources = parseNinehireSources('acme:NINEHIRE_KEY_ACME', cfg);
    expect(sources).toEqual([
      {
        scope: 'acme',
        label: 'acme',
        secretRef: 'NINEHIRE_KEY_ACME',
        enabled: true,
      },
    ]);
  });

  it('drops a source whose secret variable is not set', () => {
    // A source that can only ever 401 is worse than no source: it fails on a
    // schedule forever and teaches whoever reads the logs to ignore them.
    expect(parseNinehireSources('other:NINEHIRE_KEY_OTHER', cfg)).toEqual([]);
  });

  it('drops an entry whose second half is not an env-var NAME', () => {
    /*
     * The likeliest cause is somebody pasting the key itself into the wrong
     * field, and quietly accepting that would put a live credential into the
     * scope list — which is logged.
     */
    for (const raw of [
      'acme:hOmYWFFSwjefmEIwdWeWdQaldEid',
      'acme:lowercase_name',
      'acme:has spaces',
      'acme:x',
      'acme',
    ]) {
      expect(parseNinehireSources(raw, cfg)).toEqual([]);
    }
  });

  it('never echoes the rejected value', () => {
    const warn = jest.fn();
    parseNinehireSources('acme:hOmYWFFSwjefmEIwdWeWdQaldEid', cfg, {
      warn,
    } as never);
    for (const call of warn.mock.calls.flat()) {
      expect(String(call)).not.toContain('hOmYWFFSwjefmEIwdWeWdQaldEid');
    }
  });

  it('reads several authorized workspaces', () => {
    const many = config('', {
      NINEHIRE_KEY_A: FAKE_KEY,
      NINEHIRE_KEY_B: FAKE_KEY,
    });
    expect(
      parseNinehireSources('a:NINEHIRE_KEY_A,b:NINEHIRE_KEY_B', many).map(
        (s) => s.scope,
      ),
    ).toEqual(['a', 'b']);
  });

  it('rejects a scope that would change the request path', () => {
    expect(
      parseNinehireSources('../../v1/candidates:NINEHIRE_KEY_ACME', cfg),
    ).toEqual([]);
  });
});

describe('NinehireProvider', () => {
  describe('authorization boundary', () => {
    it('is unconfigured with no sources, and makes no request', async () => {
      const { provider: nh, calls } = provider('', () => list([]));
      expect(nh.configured).toBe(false);
      expect((await nh.fetchPage(null)).jobs).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('is unconfigured when the key is missing, and makes no request', async () => {
      // No credential means the workspace does not exist as far as this code
      // is concerned. There is no public fallback and no discovery.
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        () => list([posting('1')]),
        {},
      );
      expect(nh.configured).toBe(false);
      expect((await nh.fetchPage(null)).jobs).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('is configured once an authorized workspace is supplied', () => {
      expect(
        provider('acme:NINEHIRE_KEY_ACME', () => list([])).provider.configured,
      ).toBe(true);
    });

    it('declares the API host and only the API host', () => {
      // career.ninehire.com carries apply links, which are STORED and shown
      // but never fetched — scraping it is what the official API replaces.
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () =>
        list([]),
      );
      expect(nh.descriptor.allowedHosts).toEqual(['api.ninehire.com']);
    });

    it('paces requests inside the documented 60-per-minute limit', () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () =>
        list([]),
      );
      expect(nh.descriptor.minRequestIntervalMs).toBeGreaterThanOrEqual(1_000);
      expect(nh.descriptor.maxConcurrency).toBe(1);
    });
  });

  describe('credential handling', () => {
    it('sends the key as a Bearer header, built server-side', async () => {
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      await nh.fetchPage(null);
      expect(calls[0].headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    });

    it('never puts the key in the URL', async () => {
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      await nh.fetchPage(null);
      for (const call of calls) {
        expect(call.url).not.toContain(FAKE_KEY);
        expect(call.url).not.toMatch(/key=|token=|secret/i);
      }
    });

    it('never puts the key in a log line', async () => {
      const logged: string[] = [];
      const { provider: nh } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      const logger = (
        nh as unknown as { logger: { log: unknown; warn: unknown } }
      ).logger;
      (logger as { log: unknown }).log = (message: string) =>
        logged.push(message);
      (logger as { warn: unknown }).warn = (message: string) =>
        logged.push(message);
      await nh.fetchPage(null);
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) {
        expect(line).not.toContain(FAKE_KEY);
        expect(line.toLowerCase()).not.toContain('bearer');
        expect(line.toLowerCase()).not.toContain('authorization');
      }
    });

    it('does not expose the key on the provider instance', () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () =>
        list([]),
      );
      // The sources hold a NAME, never a value.
      expect(JSON.stringify(nh.enabledSources)).not.toContain(FAKE_KEY);
      expect(nh.enabledSources[0].secretRef).toBe('NINEHIRE_KEY_ACME');
    });

    it('gives each workspace its own key', async () => {
      const { provider: nh, calls } = provider(
        'a:NINEHIRE_KEY_A,b:NINEHIRE_KEY_B',
        workspace([posting('1')]),
        { NINEHIRE_KEY_A: 'key-a-fake', NINEHIRE_KEY_B: 'key-b-fake' },
      );
      const first = await nh.fetchPage(null);
      await nh.fetchPage(first.nextCursor);
      const listCalls = calls.filter((call) => !call.url.includes('/jobs/'));
      expect(listCalls[0].headers.authorization).toBe('Bearer key-a-fake');
      expect(listCalls[1].headers.authorization).toBe('Bearer key-b-fake');
    });
  });

  describe('what is requested', () => {
    it('calls the documented list endpoint with paging', async () => {
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      await nh.fetchPage(null);
      expect(calls[0].url).toContain('https://api.ninehire.com/api/v1/jobs?');
      expect(calls[0].url).toContain('page=1');
      expect(calls[0].url).toContain('countPerPage=');
    });

    it('never asks for private postings', async () => {
      // Not asking is stronger than filtering: unauthorized data is never
      // received rather than received and discarded.
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      await nh.fetchPage(null);
      expect(calls[0].url).toContain('includePrivate=false');
      expect(calls[0].url).not.toContain('includePrivate=true');
    });

    it('asks for unpublished postings, to see explicit closures', async () => {
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      await nh.fetchPage(null);
      expect(calls[0].url).toContain('includeUnpublished=true');
    });

    it('never touches an applicant or recruiter surface', async () => {
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      await nh.fetchPage(null);
      const all = calls.map((call) => call.url).join(' ');
      for (const surface of [
        'applicants',
        'applications',
        'candidates',
        'members',
        'users',
        'evaluations',
      ]) {
        expect(all).not.toContain(surface);
      }
    });
  });

  describe('eligibility', () => {
    it('drops private postings before ingestion', async () => {
      const { provider: nh } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([
          posting('1'),
          posting('2', { isPrivate: true }),
          posting('3'),
        ]),
      );
      const page = await nh.fetchPage(null);
      expect(page.jobs.map((job) => job.sourceJobId)).toEqual([
        'acme:1',
        'acme:3',
      ]);
    });

    it.each(['disabled', 'archived'])('drops a %s posting', async (state) => {
      const { provider: nh } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1'), posting('2', { status: state })]),
      );
      const page = await nh.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
    });

    it('keeps a closed posting, so the closure is recorded', async () => {
      const { provider: nh } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1', { status: 'closed' })]),
      );
      const page = await nh.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
      expect(page.jobs[0].closedAtSource).toBe(true);
    });

    it('does not count an excluded posting as a rejection', async () => {
      const { provider: nh } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1'), posting('2', { isPrivate: true })]),
      );
      expect((await nh.fetchPage(null)).rejected).toEqual([]);
    });

    it('never fetches detail for an excluded posting', async () => {
      // No request is made against a private posting at all.
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('secret-1', { isPrivate: true })]),
      );
      await nh.fetchPage(null);
      expect(calls.filter((call) => call.url.includes('/jobs/'))).toHaveLength(
        0,
      );
    });
  });

  describe('detail fetching', () => {
    it('enriches postings with their description', async () => {
      const { provider: nh } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace(
          [posting('1')],
          '<p>React 기반 서비스를 함께 만들 동료를 찾습니다.</p>',
        ),
      );
      const page = await nh.fetchPage(null);
      expect(page.jobs[0].description).toContain('동료를 찾습니다');
    });

    it('bounds detail calls so the shared rate budget cannot be exhausted', async () => {
      const many = Array.from({ length: 12 }, (_, i) => posting(`p${i}`));
      const calls: Call[] = [];
      const nh = new NinehireProvider(
        {
          get: (key: string, fallback?: unknown) => {
            if (key === 'externalJobs.ninehireSources')
              return 'acme:NINEHIRE_KEY_ACME';
            if (key === 'externalJobs.ninehireDetailBudget') return 3;
            if (key === 'NINEHIRE_KEY_ACME') return FAKE_KEY;
            return fallback;
          },
        } as unknown as ConfigService,
        (url, init) => {
          calls.push({ url, headers: init.headers });
          return Promise.resolve(workspace(many)(url));
        },
        () => Promise.resolve(),
      );
      const page = await nh.fetchPage(null);
      // Every posting is still ingested; only descriptions are skipped.
      expect(page.jobs).toHaveLength(12);
      expect(calls.filter((call) => call.url.includes('/jobs/'))).toHaveLength(
        3,
      );
      expect(page.jobs.filter((job) => job.description).length).toBe(3);
    });

    it('still reports the snapshot as complete when detail was skipped', async () => {
      // We saw every posting; we chose not to fetch every body. Absence stays
      // actionable.
      const many = Array.from({ length: 5 }, (_, i) => posting(`p${i}`));
      const nh = new NinehireProvider(
        {
          get: (key: string, fallback?: unknown) => {
            if (key === 'externalJobs.ninehireSources')
              return 'acme:NINEHIRE_KEY_ACME';
            if (key === 'externalJobs.ninehireDetailBudget') return 0;
            if (key === 'NINEHIRE_KEY_ACME') return FAKE_KEY;
            return fallback;
          },
        } as unknown as ConfigService,
        (url) => Promise.resolve(workspace(many)(url)),
        () => Promise.resolve(),
      );
      const page = await nh.fetchPage(null);
      expect(page.complete).toBe(true);
      expect(page.jobs).toHaveLength(5);
    });

    it('takes only the description from detail, never identity or status', async () => {
      /*
       * A detail body that disagrees about `isPrivate` or `status` must not
       * override the list, because eligibility was already decided from the
       * list — a whole-object merge would slip a private posting past a check
       * that had already passed.
       */
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', (url) =>
        url.includes('/jobs/')
          ? detail({
              id: 'a-different-id',
              isPrivate: true,
              status: 'archived',
              title: '다른 제목',
              content: '<p>진짜 상세 내용이 여기에 있습니다.</p>',
            })
          : list([posting('1', { status: 'closed' })]),
      );
      const page = await nh.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
      expect(page.jobs[0].sourceJobId).toBe('acme:1');
      expect(page.jobs[0].title).toBe('채용 1');
      expect(page.jobs[0].closedAtSource).toBe(true);
      expect(page.jobs[0].description).toContain('진짜 상세 내용');
    });

    it('loses a description, not a posting, when detail fails', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', (url) =>
        url.includes('/jobs/') ? status(500) : list([posting('1')]),
      );
      const page = await nh.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
      expect(page.jobs[0].description).toBeNull();
    });
  });

  describe('pagination and completeness', () => {
    it('claims completeness when the workspace fits one request', async () => {
      const { provider: nh } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1'), posting('2')]),
      );
      expect((await nh.fetchPage(null)).complete).toBe(true);
    });

    it('refuses completeness once paging begins', async () => {
      /*
       * page/countPerPage is offset pagination over a live collection — the
       * Lever hazard. A posting deleted between pages shifts everything up and
       * one is never returned; it would then look absent, and absence retires
       * a job.
       */
      const full = Array.from({ length: 100 }, (_, i) => posting(`p${i}`));
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', (url) =>
        url.includes('/jobs/')
          ? detail({ ...posting(idFromUrl(url)), content: '<p>내용</p>' })
          : list(full),
      );
      const first = await nh.fetchPage(null);
      expect(first.complete).toBe(false);
      expect(first.nextCursor).toBe('acme@2');
    });

    it('refuses completeness for any page after the first', async () => {
      const { provider: nh } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      expect((await nh.fetchPage('acme@2')).complete).toBe(false);
    });

    it('moves to the next workspace when a page runs short', async () => {
      const { provider: nh } = provider(
        'a:NINEHIRE_KEY_A,b:NINEHIRE_KEY_B',
        workspace([posting('1')]),
        { NINEHIRE_KEY_A: FAKE_KEY, NINEHIRE_KEY_B: FAKE_KEY },
      );
      expect((await nh.fetchPage(null)).nextCursor).toBe('b');
    });

    it('ends the sweep if the cursor no longer names a configured source', async () => {
      const { provider: nh, calls } = provider(
        'acme:NINEHIRE_KEY_ACME',
        workspace([posting('1')]),
      );
      const page = await nh.fetchPage('removed@1');
      expect(page.nextCursor).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('fails loudly when the response has no results array', async () => {
      // A shape change must never look like an empty workspace: an empty
      // COMPLETE workspace retires everything in it.
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () => ({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ count: 0 })),
      }));
      await expect(nh.fetchPage(null)).rejects.toThrow(/results array/);
    });
  });

  describe('malformed record isolation', () => {
    it('keeps every good posting when one is broken', async () => {
      const jobs = [
        ...Array.from({ length: 20 }, (_, i) => posting(`p${i}`)),
        {
          id: 'bad',
          title: '깨진 공고',
          applyUrl: 'javascript:alert(1)',
          status: 'in_progress',
          isPrivate: false,
        },
      ];
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', (url) =>
        url.includes('/jobs/')
          ? detail({ ...posting(idFromUrl(url)), content: '<p>내용</p>' })
          : list(jobs),
      );
      const page = await nh.fetchPage(null);
      expect(page.jobs).toHaveLength(20);
      expect(page.rejected).toEqual([
        { sourceJobId: 'bad', reason: expect.any(String) },
      ]);
    });

    it('reports a rejection reason without the payload or the key', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', (url) =>
        url.includes('/jobs/')
          ? detail({ id: 'bad', content: '지원자@private.example' })
          : list([
              {
                id: 'bad',
                title: '깨진 공고',
                applyUrl: null,
                status: 'in_progress',
                isPrivate: false,
              },
            ]),
      );
      const page = await nh.fetchPage(null);
      expect(page.rejected[0].reason).not.toContain('private.example');
      expect(page.rejected[0].reason).not.toContain(FAKE_KEY);
    });

    it('survives a null entry inside the array', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', (url) =>
        url.includes('/jobs/')
          ? detail({ ...posting(idFromUrl(url)), content: '<p>내용</p>' })
          : list([null, posting('1')]),
      );
      const page = await nh.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
    });
  });

  describe('upstream failures', () => {
    it.each([
      [401, /401/],
      [403, /403/],
      [429, /rate limit/i],
      [500, /500/],
    ])(
      'propagates a %s rather than reporting an empty workspace',
      async (code, match) => {
        /*
         * The critical property: an auth failure is NOT evidence that jobs
         * disappeared. Throwing makes the run FAILED, which blocks the absence
         * sweep entirely — nothing is retired.
         */
        const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () =>
          status(code),
        );
        await expect(nh.fetchPage(null)).rejects.toThrow(match);
      },
    );

    it('does not retry a 401 — the key will not become valid', async () => {
      const { provider: nh, calls } = provider('acme:NINEHIRE_KEY_ACME', () =>
        status(401, '{"message":"authentication expired"}'),
      );
      await expect(nh.fetchPage(null)).rejects.toThrow();
      expect(calls).toHaveLength(1);
    });

    it('does not retry a 403', async () => {
      const { provider: nh, calls } = provider('acme:NINEHIRE_KEY_ACME', () =>
        status(403, '{"message":"not authorized"}'),
      );
      await expect(nh.fetchPage(null)).rejects.toThrow();
      expect(calls).toHaveLength(1);
    });

    it('never leaks the key in a thrown error', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () =>
        status(401),
      );
      await expect(nh.fetchPage(null)).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(FAKE_KEY),
        }),
      );
    });

    it('propagates invalid JSON', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () => ({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('not json'),
      }));
      await expect(nh.fetchPage(null)).rejects.toThrow(/not valid JSON/);
    });

    it('propagates a timeout', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      });
      await expect(nh.fetchPage(null)).rejects.toThrow(/timed out/);
    });
  });

  describe('fetchOne', () => {
    it('re-reads one posting', async () => {
      const { provider: nh, calls } = provider('acme:NINEHIRE_KEY_ACME', () =>
        detail({ ...posting('1'), title: '간호사', content: '<p>내용</p>' }),
      );
      const result = await nh.fetchOne('acme:1');
      expect(result?.title).toBe('간호사');
      expect(calls[0].headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    });

    it('returns null when the posting has gone', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () =>
        status(404, '{"message":"resource is not found"}'),
      );
      await expect(nh.fetchOne('acme:1')).resolves.toBeNull();
    });

    it('returns null once a posting turns private', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () =>
        detail({ ...posting('1'), isPrivate: true }),
      );
      await expect(nh.fetchOne('acme:1')).resolves.toBeNull();
    });

    it('throws on a 401 — which proves nothing about the posting', async () => {
      const { provider: nh } = provider('acme:NINEHIRE_KEY_ACME', () =>
        status(401),
      );
      await expect(nh.fetchOne('acme:1')).rejects.toThrow();
    });

    it('refuses a key naming an unconfigured workspace', async () => {
      const { provider: nh, calls } = provider('acme:NINEHIRE_KEY_ACME', () =>
        detail(posting('1')),
      );
      await expect(nh.fetchOne('someoneelse:1')).resolves.toBeNull();
      expect(calls).toHaveLength(0);
    });
  });
});

describe('cursors', () => {
  it('round-trips a scope and a page', () => {
    expect(parseCursor(formatCursor('acme', 3))).toEqual({
      scope: 'acme',
      page: 3,
    });
  });

  it('reads a bare scope as page one', () => {
    expect(parseCursor('acme')).toEqual({ scope: 'acme', page: 1 });
  });

  it('resets a junk page rather than coercing it', () => {
    for (const junk of ['acme@0', 'acme@-2', 'acme@abc', 'acme@']) {
      expect(parseCursor(junk)?.page).toBe(1);
    }
  });

  it('is null for no cursor', () => {
    expect(parseCursor(null)).toBeNull();
  });
});

describe('clampPageSize', () => {
  it('respects the documented maximum of 100', () => {
    expect(clampPageSize(100)).toBe(100);
    expect(clampPageSize(500)).toBe(100);
    expect(clampPageSize(1)).toBe(10);
    expect(clampPageSize(Number.NaN)).toBe(100);
  });
});
