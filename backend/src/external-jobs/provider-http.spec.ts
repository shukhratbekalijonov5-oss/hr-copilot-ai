import {
  hostAllowed,
  parseRetryAfter,
  ProviderHttpClient,
  ProviderHttpError,
  ProviderNotFoundError,
  safeHost,
  type ProviderResponse,
} from './provider-http';

/**
 * The safety properties of provider fetching.
 *
 * These are the tests that matter most in this module: everything here guards
 * a server-side request on a timer, where the failure modes are SSRF, a retry
 * storm against somebody else's API, and a worker held open forever.
 */

const ALLOWED = ['boards-api.greenhouse.io'];

function respond(
  status: number,
  body = '{}',
  headers: Record<string, string> = {},
): ProviderResponse {
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  };
}

function client(
  // Sync or async: handlers here mostly just pick a canned response, and
  // forcing them to be async would be ceremony with no meaning.
  handler: (url: string) => ProviderResponse | Promise<ProviderResponse>,
  overrides: Partial<ConstructorParameters<typeof ProviderHttpClient>[0]> = {},
) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const http = new ProviderHttpClient({
    allowedHosts: ALLOWED,
    maxAttempts: 3,
    backoffMs: 100,
    fetchImpl: (url) => {
      calls.push(url);
      return Promise.resolve(handler(url));
    },
    // Backoff is asserted on, not waited for.
    sleepImpl: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { http, calls, sleeps };
}

describe('hostAllowed', () => {
  it('accepts the exact host', () => {
    expect(hostAllowed('https://boards-api.greenhouse.io/v1', ALLOWED)).toBe(
      true,
    );
  });

  it('accepts a true subdomain', () => {
    expect(hostAllowed('https://eu.boards-api.greenhouse.io/v1', ALLOWED)).toBe(
      true,
    );
  });

  it('rejects a lookalike registrable domain', () => {
    // The bug a naive endsWith() check has, and a domain anyone can register.
    expect(
      hostAllowed(
        'https://evil-boards-api.greenhouse.io.attacker.com/',
        ALLOWED,
      ),
    ).toBe(false);
    expect(hostAllowed('https://notboards-api.greenhouse.io/', ALLOWED)).toBe(
      false,
    );
  });

  it('rejects a different host entirely', () => {
    expect(hostAllowed('https://internal.metadata.local/', ALLOWED)).toBe(
      false,
    );
    expect(
      hostAllowed('http://169.254.169.254/latest/meta-data/', ALLOWED),
    ).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(hostAllowed('file:///etc/passwd', ALLOWED)).toBe(false);
    expect(hostAllowed('gopher://boards-api.greenhouse.io/', ALLOWED)).toBe(
      false,
    );
  });

  it('rejects credentials embedded in the URL', () => {
    expect(
      hostAllowed('https://user:pass@boards-api.greenhouse.io/v1', ALLOWED),
    ).toBe(false);
  });

  it('rejects an unparseable URL', () => {
    expect(hostAllowed('not a url', ALLOWED)).toBe(false);
  });
});

describe('ProviderHttpClient', () => {
  describe('the allowlist', () => {
    it('refuses a URL off the allowlist without making a request', async () => {
      const { http, calls } = client(() => respond(200));
      await expect(
        http.getJson('https://attacker.example/jobs'),
      ).rejects.toThrow(/allowlist/);
      expect(calls).toHaveLength(0);
    });

    it('does not retry an allowlist refusal', async () => {
      const { http, sleeps } = client(() => respond(200));
      await expect(http.getText('https://attacker.example/')).rejects.toThrow();
      expect(sleeps).toHaveLength(0);
    });
  });

  describe('redirects', () => {
    it('follows a redirect that stays on the allowlist', async () => {
      const { http, calls } = client((url) =>
        url.endsWith('/jobs')
          ? respond(302, '', {
              location: 'https://boards-api.greenhouse.io/moved',
            })
          : respond(200, '{"ok":true}'),
      );
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).resolves.toEqual({ ok: true });
      expect(calls).toHaveLength(2);
    });

    it('refuses a redirect off the allowlist', async () => {
      // The whole reason redirects are followed by hand.
      const { http, calls } = client(() =>
        respond(302, '', { location: 'https://attacker.example/steal' }),
      );
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).rejects.toThrow(/outside its allowlist/);
      expect(calls).toHaveLength(1);
    });

    it('refuses a redirect to a non-http scheme', async () => {
      const { http } = client(() =>
        respond(302, '', { location: 'file:///etc/passwd' }),
      );
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).rejects.toThrow(/outside its allowlist/);
    });

    it('stops after the redirect limit', async () => {
      const { http } = client(
        () =>
          respond(302, '', {
            location: 'https://boards-api.greenhouse.io/loop',
          }),
        { maxRedirects: 2 },
      );
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).rejects.toThrow(/redirects/);
    });

    it('fails a redirect with no location', async () => {
      const { http } = client(() => respond(302, ''));
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).rejects.toThrow(/no location/);
    });
  });

  describe('status handling', () => {
    it('reports 404 as a not-found, which is evidence about the resource', async () => {
      const { http } = client(() => respond(404, '{"error":"Job not found"}'));
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs/1'),
      ).rejects.toBeInstanceOf(ProviderNotFoundError);
    });

    it('does not retry a 404', async () => {
      const { http, calls } = client(() => respond(404));
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs/1'),
      ).rejects.toThrow();
      expect(calls).toHaveLength(1);
    });

    it('retries a 429 and honours Retry-After', async () => {
      let attempt = 0;
      const { http, calls, sleeps } = client(() => {
        attempt += 1;
        return attempt === 1
          ? respond(429, '', { 'retry-after': '2' })
          : respond(200, '{"ok":true}');
      });
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).resolves.toEqual({ ok: true });
      expect(calls).toHaveLength(2);
      expect(sleeps).toEqual([2_000]);
    });

    it('retries a 500 with exponential backoff', async () => {
      let attempt = 0;
      const { http, sleeps } = client(() => {
        attempt += 1;
        return attempt < 3 ? respond(500) : respond(200, '{"ok":true}');
      });
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).resolves.toEqual({ ok: true });
      // Doubling, not a flat interval — a fixed short delay under load is a
      // retry storm with extra steps.
      expect(sleeps).toEqual([100, 200]);
    });

    it('gives up after the attempt limit rather than retrying forever', async () => {
      const { http, calls } = client(() => respond(503));
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).rejects.toThrow(/503/);
      expect(calls).toHaveLength(3);
    });

    it('does not retry a 401 or 403', async () => {
      for (const status of [400, 401, 403]) {
        const { http, calls } = client(() => respond(status));
        await expect(
          http.getJson('https://boards-api.greenhouse.io/jobs'),
        ).rejects.toThrow();
        expect(calls).toHaveLength(1);
      }
    });
  });

  describe('timeouts and transport failures', () => {
    it('retries an aborted request', async () => {
      let attempt = 0;
      const { http, calls } = client(() => {
        attempt += 1;
        if (attempt === 1) {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }
        return respond(200, '{"ok":true}');
      });
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).resolves.toEqual({ ok: true });
      expect(calls).toHaveLength(2);
    });

    it('reports a timeout with the deadline, not the URL', async () => {
      const { http } = client(
        () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        },
        { maxAttempts: 1, timeoutMs: 7_500 },
      );
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs?secret=abc'),
      ).rejects.toThrow(/timed out after 7500ms/);
    });

    it('retries a network error', async () => {
      let attempt = 0;
      const { http, calls } = client(() => {
        attempt += 1;
        if (attempt === 1) throw new Error('ECONNRESET');
        return respond(200, '{"ok":true}');
      });
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).resolves.toEqual({ ok: true });
      expect(calls).toHaveLength(2);
    });
  });

  describe('response bodies', () => {
    it('rejects a body that is not JSON', async () => {
      const { http } = client(() => respond(200, '<html>nope</html>'));
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).rejects.toThrow(/not valid JSON/);
    });

    it('never puts the body in the error message', async () => {
      const secret = 'candidate@example.com';
      const { http } = client(() => respond(200, `<p>${secret}</p>`));
      await expect(
        http.getJson('https://boards-api.greenhouse.io/jobs'),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(secret),
        }),
      );
    });

    it('refuses a body over the ceiling', async () => {
      const { http } = client(() => respond(200, 'x'.repeat(5_000)), {
        maxResponseBytes: 1_000,
        maxAttempts: 1,
      });
      await expect(
        http.getText('https://boards-api.greenhouse.io/jobs'),
      ).rejects.toThrow(/exceeded 1000 bytes/);
    });
  });

  describe('request pacing', () => {
    it('waits the minimum interval between requests', async () => {
      const { http, sleeps } = client(() => respond(200, '{"ok":true}'), {
        minRequestIntervalMs: 1_000,
      });
      await http.getJson('https://boards-api.greenhouse.io/a');
      await http.getJson('https://boards-api.greenhouse.io/b');
      // The first request has no predecessor to wait for; the second does.
      expect(sleeps.some((ms) => ms > 0)).toBe(true);
    });
  });
});

describe('parseRetryAfter', () => {
  it('reads a delay in seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('reads an HTTP date', () => {
    const when = new Date(Date.now() + 20_000).toUTCString();
    const parsed = parseRetryAfter(when)!;
    expect(parsed).toBeGreaterThan(10_000);
    expect(parsed).toBeLessThanOrEqual(21_000);
  });

  it('caps an absurd delay rather than sleeping for a day', () => {
    expect(parseRetryAfter('999999')).toBe(3_600_000);
  });

  it('ignores nonsense', () => {
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('never returns a negative delay for a past date', () => {
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(
      0,
    );
  });
});

describe('safeHost', () => {
  it('keeps only the host, never the query string', () => {
    expect(
      safeHost('https://boards-api.greenhouse.io/v1/boards/x?key=SECRET'),
    ).toBe('boards-api.greenhouse.io');
  });

  it('does not throw on garbage', () => {
    expect(safeHost('%%%')).toBe('<unparseable url>');
  });
});

describe('ProviderHttpError', () => {
  it('carries whether a retry could help', () => {
    expect(new ProviderHttpError('boom', 500, true).retryable).toBe(true);
    expect(new ProviderNotFoundError(404).retryable).toBe(false);
  });
});
