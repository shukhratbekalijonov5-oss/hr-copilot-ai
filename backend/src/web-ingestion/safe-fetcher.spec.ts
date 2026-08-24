import * as dns from 'node:dns';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LinkFailureCode } from '../generated/prisma/enums';
import { WebIngestionError } from './web-ingestion.errors';
import {
  SafeHttpFetcher,
  type HttpTransport,
  type RawResponse,
} from './safe-fetcher';
import { WEB_INGESTION_LIMITS } from './web-ingestion.limits';

/**
 * SSRF behaviour of the fetcher itself.
 *
 * Two layers are exercised separately because they fail differently:
 *
 *  - DNS: a perfectly ordinary public hostname that RESOLVES to a private
 *    address. Syntax cannot catch this; only resolving and classifying can.
 *  - Redirects: a public site that answers 302 into somewhere we may not go.
 *    An HTTP client following redirects for us would skip both checks on every
 *    hop after the first, which is why they are followed by hand.
 */

const DEADLINE = () => Date.now() + 30_000;

/** A transport that replays scripted responses and records what was requested. */
function fakeTransport(
  responses: (RawResponse | Error)[],
): HttpTransport & { requested: string[]; addresses: string[] } {
  const requested: string[] = [];
  const addresses: string[] = [];
  let index = 0;
  return {
    requested,
    addresses,
    send(url, pinned) {
      requested.push(url.toString());
      addresses.push(pinned.address);
      const next = responses[index++];
      if (!next) throw new Error('fake transport ran out of responses');
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
  };
}

function ok(body: string, contentType = 'text/html'): RawResponse {
  return {
    status: 200,
    headers: { 'content-type': contentType },
    body: Buffer.from(body, 'utf8'),
  };
}

function redirect(to: string, status = 302): RawResponse {
  return { status, headers: { location: to }, body: Buffer.alloc(0) };
}

function mockLookup(addresses: { address: string; family: number }[]) {
  return jest
    .spyOn(dns.promises, 'lookup')
    .mockResolvedValue(addresses as never);
}

async function expectFailure(
  run: Promise<unknown>,
  code: LinkFailureCode,
): Promise<void> {
  await expect(run).rejects.toMatchObject({ code });
  await expect(run).rejects.toBeInstanceOf(WebIngestionError);
}

afterEach(() => jest.restoreAllMocks());

describe('SafeHttpFetcher — DNS', () => {
  it('refuses a public hostname that resolves to a loopback address', async () => {
    mockLookup([{ address: '127.0.0.1', family: 4 }]);
    const fetcher = new SafeHttpFetcher(fakeTransport([ok('<p>hi</p>')]));

    await expectFailure(
      fetcher.fetchText('https://portfolio.example.com/', {
        deadline: DEADLINE(),
      }),
      LinkFailureCode.PRIVATE_NETWORK_URL,
    );
  });

  it.each([
    ['10.1.2.3'],
    ['172.20.0.5'],
    ['192.168.1.10'],
    ['169.254.169.254'],
    ['100.100.0.1'],
  ])('refuses a hostname resolving to %s', async (address) => {
    mockLookup([{ address, family: 4 }]);
    const fetcher = new SafeHttpFetcher(fakeTransport([ok('<p>hi</p>')]));

    await expectFailure(
      fetcher.fetchText('https://portfolio.example.com/', {
        deadline: DEADLINE(),
      }),
      LinkFailureCode.PRIVATE_NETWORK_URL,
    );
  });

  it('refuses when ANY resolved address is private, not just the first', async () => {
    // A split answer is either a misconfiguration or an attack; taking the
    // public one and proceeding would reward the attempt.
    mockLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);
    const fetcher = new SafeHttpFetcher(fakeTransport([ok('<p>hi</p>')]));

    await expectFailure(
      fetcher.fetchText('https://portfolio.example.com/', {
        deadline: DEADLINE(),
      }),
      LinkFailureCode.PRIVATE_NETWORK_URL,
    );
  });

  it('refuses an IPv6 answer that wraps a private IPv4 address', async () => {
    mockLookup([{ address: '::ffff:169.254.169.254', family: 6 }]);
    const fetcher = new SafeHttpFetcher(fakeTransport([ok('<p>hi</p>')]));

    await expectFailure(
      fetcher.fetchText('https://portfolio.example.com/', {
        deadline: DEADLINE(),
      }),
      LinkFailureCode.PRIVATE_NETWORK_URL,
    );
  });

  it('reports an unresolvable hostname as an invalid URL', async () => {
    jest
      .spyOn(dns.promises, 'lookup')
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const fetcher = new SafeHttpFetcher(fakeTransport([ok('<p>hi</p>')]));

    await expectFailure(
      fetcher.fetchText('https://nope.example.com/', { deadline: DEADLINE() }),
      LinkFailureCode.INVALID_URL,
    );
  });

  it('pins the socket to the address it validated', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const transport = fakeTransport([ok('<p>hi</p>')]);
    const fetcher = new SafeHttpFetcher(transport);

    await fetcher.fetchText('https://portfolio.example.com/', {
      deadline: DEADLINE(),
    });
    // The pinned address is what closes DNS rebinding: there is no second
    // resolution between the check and the connection.
    expect(transport.addresses).toEqual(['93.184.216.34']);
  });
});

describe('SafeHttpFetcher — redirects', () => {
  it('follows an ordinary public redirect', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const transport = fakeTransport([
      redirect('https://www.example.com/moved'),
      ok('<p>arrived</p>'),
    ]);
    const fetcher = new SafeHttpFetcher(transport);

    const result = await fetcher.fetchText('https://example.com/', {
      deadline: DEADLINE(),
    });
    expect(result.body).toContain('arrived');
    expect(result.url).toBe('https://www.example.com/moved');
  });

  it('refuses a redirect into the cloud metadata endpoint', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const fetcher = new SafeHttpFetcher(
      fakeTransport([
        redirect('http://169.254.169.254/latest/meta-data/iam/'),
        ok('secret-credentials'),
      ]),
    );

    await expectFailure(
      fetcher.fetchText('https://example.com/', { deadline: DEADLINE() }),
      LinkFailureCode.PRIVATE_NETWORK_URL,
    );
  });

  it('refuses a redirect into an internal hostname', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const fetcher = new SafeHttpFetcher(
      fakeTransport([redirect('http://admin.internal/'), ok('internal')]),
    );

    await expectFailure(
      fetcher.fetchText('https://example.com/', { deadline: DEADLINE() }),
      LinkFailureCode.PRIVATE_NETWORK_URL,
    );
  });

  it('refuses a redirect into a non-HTTP scheme', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const fetcher = new SafeHttpFetcher(
      fakeTransport([redirect('file:///etc/passwd'), ok('root:x:0:0')]),
    );

    await expectFailure(
      fetcher.fetchText('https://example.com/', { deadline: DEADLINE() }),
      LinkFailureCode.UNSUPPORTED_PROTOCOL,
    );
  });

  it('refuses a redirect onto an unusual port', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const fetcher = new SafeHttpFetcher(
      fakeTransport([redirect('http://example.com:6379/'), ok('PONG')]),
    );

    await expectFailure(
      fetcher.fetchText('https://example.com/', { deadline: DEADLINE() }),
      LinkFailureCode.UNSUPPORTED_PROTOCOL,
    );
  });

  it('re-resolves the address on the redirect target', async () => {
    const lookup = jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      // The redirect target is a public NAME that resolves privately — the
      // exact shape a "check the first hop only" fetcher walks into.
      .mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }] as never);

    const fetcher = new SafeHttpFetcher(
      fakeTransport([
        redirect('https://internal-looking.example.com/'),
        ok('x'),
      ]),
    );

    await expectFailure(
      fetcher.fetchText('https://example.com/', { deadline: DEADLINE() }),
      LinkFailureCode.PRIVATE_NETWORK_URL,
    );
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('stops a redirect loop at the configured limit', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const loop = Array.from({ length: 10 }, () =>
      redirect('https://example.com/again'),
    );
    const fetcher = new SafeHttpFetcher(fakeTransport(loop));

    await expectFailure(
      fetcher.fetchText('https://example.com/', { deadline: DEADLINE() }),
      LinkFailureCode.TOO_MANY_REDIRECTS,
    );
  });

  it('resolves a relative Location against the current URL', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const transport = fakeTransport([redirect('/about'), ok('<p>about</p>')]);
    const fetcher = new SafeHttpFetcher(transport);

    await fetcher.fetchText('https://example.com/home', {
      deadline: DEADLINE(),
    });
    expect(transport.requested[1]).toBe('https://example.com/about');
  });
});

describe('SafeHttpFetcher — caller host allowlist', () => {
  /*
   * A second gate, for callers that fetch on a SCHEDULE against a fixed set of
   * approved sites rather than wherever a person pasted. "Public and
   * reachable" is not the same question as "one of the hosts this caller was
   * configured for", and external job ingestion needs both answered.
   */
  const publicAddress = [{ address: '93.184.216.34', family: 4 }];

  it('fetches a host the caller allows', async () => {
    mockLookup(publicAddress);
    const transport = fakeTransport([ok('<h1>Careers</h1>')]);
    const fetcher = new SafeHttpFetcher(transport);

    const result = await fetcher.fetchText('https://example.com/careers', {
      deadline: DEADLINE(),
      allowHost: (url) => url.hostname === 'example.com',
    });

    expect(result.body).toContain('Careers');
  });

  it('refuses a host the caller does not allow, before any request', async () => {
    mockLookup(publicAddress);
    const transport = fakeTransport([ok('never reached')]);
    const fetcher = new SafeHttpFetcher(transport);

    await expectFailure(
      fetcher.fetchText('https://other-company.org/careers', {
        deadline: DEADLINE(),
        allowHost: (url) => url.hostname === 'example.com',
      }),
      LinkFailureCode.ACCESS_DENIED,
    );
    // Not merely rejected afterwards — never sent.
    expect(transport.requested).toEqual([]);
  });

  it('refuses a REDIRECT off the caller allowlist', async () => {
    // The hop is the whole point: a check applied only to the first URL is a
    // check the first response can redirect around.
    mockLookup(publicAddress);
    const transport = fakeTransport([
      redirect('https://elsewhere.org/jobs'),
      ok('should never be read'),
    ]);
    const fetcher = new SafeHttpFetcher(transport);

    await expectFailure(
      fetcher.fetchText('https://example.com/careers', {
        deadline: DEADLINE(),
        allowHost: (url) => url.hostname === 'example.com',
      }),
      LinkFailureCode.ACCESS_DENIED,
    );
    expect(transport.requested).toEqual(['https://example.com/careers']);
  });

  it('still allows a same-host redirect', async () => {
    mockLookup(publicAddress);
    const transport = fakeTransport([
      redirect('https://example.com/company/careers'),
      ok('<h1>Careers</h1>'),
    ]);
    const fetcher = new SafeHttpFetcher(transport);

    const result = await fetcher.fetchText('https://example.com/careers', {
      deadline: DEADLINE(),
      allowHost: (url) => url.hostname === 'example.com',
    });

    expect(result.url).toBe('https://example.com/company/careers');
  });

  it('leaves callers without an allowlist unchanged', async () => {
    mockLookup(publicAddress);
    const transport = fakeTransport([ok('<h1>Portfolio</h1>')]);
    const fetcher = new SafeHttpFetcher(transport);

    const result = await fetcher.fetchText('https://anything.org/page', {
      deadline: DEADLINE(),
    });

    expect(result.status).toBe(200);
  });
});

describe('SafeHttpFetcher — user agent', () => {
  it("sends the caller's agent when one is given", async () => {
    // So a site operator can tell scheduled job ingestion from a
    // candidate-submitted link fetch, and write a robots rule for one.
    mockLookup([{ address: '93.184.216.34', family: 4 }]);
    const seen: (string | undefined)[] = [];
    const fetcher = new SafeHttpFetcher({
      send: (_url, _pinned, options) => {
        seen.push(options.userAgent);
        return Promise.resolve(ok('<h1>hi</h1>'));
      },
    });

    await fetcher.fetchText('https://example.com/careers', {
      deadline: DEADLINE(),
      userAgent: 'HRCopilotJobBot/1.0',
    });

    expect(seen).toEqual(['HRCopilotJobBot/1.0']);
  });
});

describe('SafeHttpFetcher — response policy', () => {
  beforeEach(() => mockLookup([{ address: '93.184.216.34', family: 4 }]));

  it('refuses an unsupported content type', async () => {
    const fetcher = new SafeHttpFetcher(
      fakeTransport([ok('%PDF-1.7', 'application/pdf')]),
    );
    await expectFailure(
      fetcher.fetchText('https://example.com/cv.pdf', { deadline: DEADLINE() }),
      LinkFailureCode.UNSUPPORTED_CONTENT_TYPE,
    );
  });

  it.each([
    ['image/png'],
    ['application/zip'],
    ['application/octet-stream'],
    ['video/mp4'],
  ])('refuses %s', async (contentType) => {
    const fetcher = new SafeHttpFetcher(
      fakeTransport([ok('binary', contentType)]),
    );
    await expectFailure(
      fetcher.fetchText('https://example.com/x', { deadline: DEADLINE() }),
      LinkFailureCode.UNSUPPORTED_CONTENT_TYPE,
    );
  });

  it('accepts HTML and plain text', async () => {
    for (const contentType of [
      'text/html',
      'text/plain',
      'application/xhtml+xml',
    ]) {
      const fetcher = new SafeHttpFetcher(
        fakeTransport([ok('content here', contentType)]),
      );
      const result = await fetcher.fetchText('https://example.com/x', {
        deadline: DEADLINE(),
      });
      expect(result.mediaType).toBe(contentType);
    }
  });

  it('maps a refusal or a missing page to ACCESS_DENIED', async () => {
    for (const status of [401, 403, 404, 410, 451]) {
      const fetcher = new SafeHttpFetcher(
        fakeTransport([{ status, headers: {}, body: Buffer.alloc(0) }]),
      );
      await expectFailure(
        fetcher.fetchText('https://example.com/x', { deadline: DEADLINE() }),
        LinkFailureCode.ACCESS_DENIED,
      );
    }
  });

  it('maps a server error or rate limit to a RETRYABLE upstream error', async () => {
    for (const status of [429, 500, 502, 503, 504]) {
      const fetcher = new SafeHttpFetcher(
        fakeTransport([{ status, headers: {}, body: Buffer.alloc(0) }]),
      );
      await expectFailure(
        fetcher.fetchText('https://example.com/x', { deadline: DEADLINE() }),
        LinkFailureCode.UPSTREAM_ERROR,
      );
    }
  });

  it('refuses a body over the byte cap', async () => {
    const huge = 'x'.repeat(WEB_INGESTION_LIMITS.maxResponseBytes + 1);
    const fetcher = new SafeHttpFetcher(fakeTransport([ok(huge)]));
    await expectFailure(
      fetcher.fetchText('https://example.com/x', { deadline: DEADLINE() }),
      LinkFailureCode.CONTENT_TOO_LARGE,
    );
  });

  it('stops when the whole-link budget is already spent', async () => {
    const fetcher = new SafeHttpFetcher(fakeTransport([ok('<p>hi</p>')]));
    await expectFailure(
      fetcher.fetchText('https://example.com/x', { deadline: Date.now() - 1 }),
      LinkFailureCode.FETCH_TIMEOUT,
    );
  });

  it('decodes a declared legacy charset', async () => {
    const fetcher = new SafeHttpFetcher(
      fakeTransport([
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=iso-8859-1' },
          body: Buffer.from([0x63, 0x61, 0x66, 0xe9]), // "café" in latin-1
        },
      ]),
    );
    const result = await fetcher.fetchText('https://example.com/x', {
      deadline: DEADLINE(),
    });
    expect(result.body).toBe('café');
  });
});

describe('SafeHttpFetcher — against a real local server', () => {
  /**
   * End-to-end proof with a genuine socket: a service really listening on
   * loopback is unreachable through this fetcher, whichever way it is
   * addressed. The real transport is used here — no fakes.
   */
  let server: http.Server;
  let port: number;
  let hits = 0;

  beforeAll(async () => {
    server = http.createServer((_request, response) => {
      hits += 1;
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body>INTERNAL SECRET</body></html>');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    hits = 0;
  });

  it.each(['http://127.0.0.1', 'http://localhost', 'http://[::1]'])(
    'never reaches the loopback server via %s',
    async (base) => {
      const fetcher = new SafeHttpFetcher();

      // Whichever check fires first — unusual port, IP literal, single-label
      // host, or the resolved loopback address — the request is never sent.
      await expect(
        fetcher.fetchText(`${base}:${port}/`, { deadline: DEADLINE() }),
      ).rejects.toBeInstanceOf(WebIngestionError);
      expect(hits).toBe(0);
    },
  );

  it('names the loopback address as a private target on the default port', async () => {
    const fetcher = new SafeHttpFetcher();
    await expect(
      fetcher.fetchText('http://127.0.0.1/', { deadline: DEADLINE() }),
    ).rejects.toMatchObject({ code: LinkFailureCode.PRIVATE_NETWORK_URL });
    expect(hits).toBe(0);
  });

  it('reaches the same server when the guard is not in the way', async () => {
    // Control case: the fetcher's transport works. If this ever fails, the
    // negatives above are proving nothing.
    const response = await new Promise<string>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/' }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += String(chunk)));
          res.on('end', () => resolve(body));
        })
        .on('error', reject);
    });
    expect(response).toContain('INTERNAL SECRET');
    expect(hits).toBe(1);
  });
});
