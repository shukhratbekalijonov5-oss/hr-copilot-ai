import { ConfigService } from '@nestjs/config';
import { GreenhouseProvider, splitSourceKey } from './greenhouse.provider';
import { parseBoardConfig } from './greenhouse.boards';
import type { ProviderResponse } from '../../provider-http';

/**
 * The provider, exercised against captured response shapes.
 *
 * No test here reaches the network. The live proof that these shapes are real
 * is in the ingestion run against public boards; what this file pins is that
 * the parsing, the completeness check, the isolation and the error handling
 * behave the way the architecture claims when the responses go wrong.
 */

function job(id: number, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    company_name: 'Acme',
    location: { name: 'London' },
    offices: [{ name: 'London', location: 'London, England, United Kingdom' }],
    content:
      '&lt;p&gt;We are hiring for a role on the London team and would love ' +
      'to hear from you.&lt;/p&gt;',
    ...extra,
  };
}

function config(boards: string): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'externalJobs.greenhouseBoards' ? boards : fallback,
  } as unknown as ConfigService;
}

function provider(
  boards: string,
  handler: (url: string) => ProviderResponse | Promise<ProviderResponse>,
) {
  const calls: string[] = [];
  const instance = new GreenhouseProvider(config(boards), (url) => {
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

describe('parseBoardConfig', () => {
  it('reads a comma-separated list', () => {
    expect(parseBoardConfig('acme, globex').map((b) => b.boardToken)).toEqual([
      'acme',
      'globex',
    ]);
  });

  it('reads an optional label', () => {
    const [board] = parseBoardConfig('acme:Acme Corporation');
    expect(board).toMatchObject({
      boardToken: 'acme',
      label: 'Acme Corporation',
    });
  });

  it('defaults the label to the token', () => {
    expect(parseBoardConfig('acme')[0].label).toBe('acme');
  });

  it('deduplicates repeated tokens', () => {
    expect(parseBoardConfig('acme,acme,ACME')).toHaveLength(1);
  });

  it('drops a token that would change the request path', () => {
    // These values are pasted into a URL. Anything but a slug is refused
    // rather than escaped and hoped for.
    const boards = parseBoardConfig(
      'acme,../../v1/harvest,https://evil.example/x,acme%2f..,ACME BOARD',
    );
    expect(boards.map((b) => b.boardToken)).toEqual(['acme']);
  });

  it('returns nothing for empty configuration', () => {
    expect(parseBoardConfig(undefined)).toEqual([]);
    expect(parseBoardConfig('   ')).toEqual([]);
  });
});

describe('GreenhouseProvider', () => {
  describe('configuration', () => {
    it('is unconfigured with no boards, and makes no request', async () => {
      const { provider: gh, calls } = provider('', () => ok({}));
      expect(gh.configured).toBe(false);
      const page = await gh.fetchPage(null);
      expect(page.jobs).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it('is configured once a board is listed', () => {
      expect(provider('acme', () => ok({})).provider.configured).toBe(true);
    });

    it('declares the API host and only the API host', () => {
      const { provider: gh } = provider('acme', () => ok({}));
      // Apply links live on job-boards.greenhouse.io and are STORED, never
      // fetched. Widening the fetch allowlist to every host a posting might
      // link to is what an allowlist exists to prevent.
      expect(gh.descriptor.allowedHosts).toEqual(['boards-api.greenhouse.io']);
    });

    it('declares the official API as its access method', () => {
      const { provider: gh } = provider('acme', () => ok({}));
      expect(gh.descriptor.accessMethod).toBe('OFFICIAL_API');
      expect(gh.descriptor.provider).toBe('GREENHOUSE');
    });

    it('paces its own requests', () => {
      const { provider: gh } = provider('acme', () => ok({}));
      expect(gh.descriptor.minRequestIntervalMs).toBeGreaterThan(0);
      expect(gh.descriptor.maxConcurrency).toBe(1);
    });
  });

  describe('listing a board', () => {
    it('calls the documented public endpoint with no credential', async () => {
      const { provider: gh, calls } = provider('acme', () =>
        ok({ jobs: [job(1, 'Account Executive')], meta: { total: 1 } }),
      );
      await gh.fetchPage(null);
      expect(calls[0]).toContain(
        'https://boards-api.greenhouse.io/v1/boards/acme/jobs',
      );
      expect(calls[0]).toContain('content=true');
      expect(calls[0]).toContain('pay_transparency=true');
      // No key, token or secret anywhere in the request.
      expect(calls[0]).not.toMatch(/key|token=|secret|authorization/i);
    });

    it('never touches a Harvest endpoint', async () => {
      const { provider: gh, calls } = provider('acme', () =>
        ok({ jobs: [], meta: { total: 0 } }),
      );
      await gh.fetchPage(null);
      expect(calls.join(' ')).not.toContain('harvest');
      expect(calls.join(' ')).not.toContain('candidates');
      expect(calls.join(' ')).not.toContain('applications');
    });

    it('normalizes every posting it can', async () => {
      const { provider: gh } = provider('acme', () =>
        ok({
          jobs: [job(1, 'Account Executive'), job(2, 'Staff Nurse')],
          meta: { total: 2 },
        }),
      );
      const page = await gh.fetchPage(null);
      expect(page.jobs.map((entry) => entry.title)).toEqual([
        'Account Executive',
        'Staff Nurse',
      ]);
      expect(page.scopeKey).toBe('acme');
    });

    it('reports the board as the scope', async () => {
      const { provider: gh } = provider('acme,globex', () =>
        ok({ jobs: [], meta: { total: 0 } }),
      );
      // The cursor names the board to fetch, so the first call starts at the
      // head of the list and the cursor it returns addresses the next board.
      const first = await gh.fetchPage(null);
      expect(first.scopeKey).toBe('acme');
      expect((await gh.fetchPage(first.nextCursor)).scopeKey).toBe('globex');
    });
  });

  describe('walking boards', () => {
    it('returns the next board as the cursor and ends on the last', async () => {
      const { provider: gh } = provider('acme,globex', () =>
        ok({ jobs: [], meta: { total: 0 } }),
      );
      expect((await gh.fetchPage(null)).nextCursor).toBe('globex');
      expect((await gh.fetchPage('globex')).nextCursor).toBeNull();
    });

    it('fetches one board per page rather than all of them at once', async () => {
      const { provider: gh, calls } = provider('acme,globex,initech', () =>
        ok({ jobs: [], meta: { total: 0 } }),
      );
      await gh.fetchPage(null);
      expect(calls).toHaveLength(1);
    });

    it('ends the sweep if the cursor no longer names a configured board', async () => {
      const { provider: gh, calls } = provider('acme', () =>
        ok({ jobs: [], meta: { total: 0 } }),
      );
      const page = await gh.fetchPage('a-board-removed-from-config');
      expect(page.nextCursor).toBeNull();
      expect(calls).toHaveLength(0);
    });
  });

  describe('completeness', () => {
    it('claims completeness only when meta.total matches the array', async () => {
      const { provider: gh } = provider('acme', () =>
        ok({ jobs: [job(1, 'A'), job(2, 'B')], meta: { total: 2 } }),
      );
      expect((await gh.fetchPage(null)).complete).toBe(true);
    });

    it('reports a truncated listing as incomplete', async () => {
      // The listing says there are 50 and sent 2. Acting on absence here would
      // retire 48 live jobs.
      const { provider: gh } = provider('acme', () =>
        ok({ jobs: [job(1, 'A'), job(2, 'B')], meta: { total: 50 } }),
      );
      expect((await gh.fetchPage(null)).complete).toBe(false);
    });

    it('reports incomplete when no total is given', async () => {
      const { provider: gh } = provider('acme', () =>
        ok({ jobs: [job(1, 'A')] }),
      );
      expect((await gh.fetchPage(null)).complete).toBe(false);
    });

    it('counts the RAW array, not what normalized', async () => {
      // Our own mapping failure must not read as the board being short.
      const { provider: gh } = provider('acme', () =>
        ok({
          jobs: [job(1, 'A'), { id: 2, title: null, absolute_url: null }],
          meta: { total: 2 },
        }),
      );
      const page = await gh.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
      expect(page.rejected).toHaveLength(1);
      expect(page.complete).toBe(true);
    });
  });

  describe('malformed record isolation', () => {
    it('keeps every good posting when one is broken', async () => {
      const jobs = [
        ...Array.from({ length: 100 }, (_, i) => job(i + 1, `Role ${i + 1}`)),
        { id: 999, title: 'Broken', absolute_url: 'javascript:alert(1)' },
      ];
      const { provider: gh } = provider('acme', () =>
        ok({ jobs, meta: { total: 101 } }),
      );
      const page = await gh.fetchPage(null);
      expect(page.jobs).toHaveLength(100);
      expect(page.rejected).toHaveLength(1);
      expect(page.rejected[0].sourceJobId).toBe('999');
    });

    it('reports a rejection reason without the payload', async () => {
      const { provider: gh } = provider('acme', () =>
        ok({
          jobs: [
            {
              id: 5,
              title: 'Broken',
              absolute_url: null,
              content: 'applicant@private.example',
            },
          ],
          meta: { total: 1 },
        }),
      );
      const page = await gh.fetchPage(null);
      expect(page.rejected[0].reason).not.toContain('private.example');
    });

    it('survives a jobs field that is not an array', async () => {
      const { provider: gh } = provider('acme', () =>
        ok({ jobs: 'nope', meta: { total: 0 } }),
      );
      const page = await gh.fetchPage(null);
      expect(page.jobs).toEqual([]);
      expect(page.complete).toBe(true);
    });

    it('survives a null entry inside the array', async () => {
      const { provider: gh } = provider('acme', () =>
        ok({ jobs: [null, job(1, 'Real Role')], meta: { total: 2 } }),
      );
      const page = await gh.fetchPage(null);
      expect(page.jobs).toHaveLength(1);
      expect(page.rejected).toHaveLength(1);
    });
  });

  describe('upstream failures', () => {
    it('propagates a 500 so the run is recorded as failed', async () => {
      const { provider: gh } = provider('acme', () => status(500));
      await expect(gh.fetchPage(null)).rejects.toThrow(/500/);
    });

    it('propagates a 429', async () => {
      const { provider: gh } = provider('acme', () => status(429));
      await expect(gh.fetchPage(null)).rejects.toThrow(/rate limit/i);
    });

    it('propagates invalid JSON', async () => {
      const { provider: gh } = provider('acme', () => ({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve('not json at all'),
      }));
      await expect(gh.fetchPage(null)).rejects.toThrow(/not valid JSON/);
    });

    it('propagates a timeout', async () => {
      const { provider: gh } = provider('acme', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      });
      await expect(gh.fetchPage(null)).rejects.toThrow(/timed out/);
    });
  });

  describe('fetchOne', () => {
    it('re-reads one posting by board and id', async () => {
      const { provider: gh, calls } = provider('acme', () =>
        ok(job(42, 'Account Executive')),
      );
      const result = await gh.fetchOne('acme:42');
      expect(result?.title).toBe('Account Executive');
      expect(calls[0]).toBe(
        'https://boards-api.greenhouse.io/v1/boards/acme/jobs/42',
      );
    });

    it('returns null on 404 — evidence the posting is gone', async () => {
      const { provider: gh } = provider('acme', () => status(404));
      await expect(gh.fetchOne('acme:42')).resolves.toBeNull();
    });

    it('throws on a 500 — which proves nothing about the posting', async () => {
      // The distinction this method exists for: null retires a source, a throw
      // must not.
      const { provider: gh } = provider('acme', () => status(500));
      await expect(gh.fetchOne('acme:42')).rejects.toThrow();
    });

    it('refuses a key naming an unconfigured board', async () => {
      const { provider: gh, calls } = provider('acme', () => ok(job(1, 'X')));
      await expect(gh.fetchOne('someoneelse:42')).resolves.toBeNull();
      expect(calls).toHaveLength(0);
    });
  });
});

describe('splitSourceKey', () => {
  it('splits board from id on the first colon', () => {
    expect(splitSourceKey('acme:12345')).toEqual(['acme', '12345']);
  });

  it('reports no id when the key is unqualified', () => {
    expect(splitSourceKey('acme')).toEqual(['acme', null]);
  });
});
