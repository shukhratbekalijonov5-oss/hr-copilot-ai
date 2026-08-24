import { Logger } from '@nestjs/common';
import {
  COMPANY_CAREERS_CATALOGUE,
  REVIEWED_AND_REJECTED,
  isFetchableForSource,
  isStorableApplyUrl,
  parseCompanyCareersConfig,
} from './company-careers.catalogue';

/**
 * The gate between an environment variable and an outbound request.
 *
 * This is the highest-consequence file in the provider. Everything else can
 * produce a wrong job; a mistake here produces a server-side request to a
 * destination someone else chose, from inside the network where the cloud
 * metadata endpoint lives. So the tests are about what CANNOT happen.
 */

function quiet(): Logger {
  const logger = new Logger('test');
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  return logger;
}

const vercel = COMPANY_CAREERS_CATALOGUE.find(
  (source) => source.sourceId === 'vercel-careers',
)!;

describe('configuration selects from the catalogue and cannot add to it', () => {
  /*
   * Every real entry is currently reviewed OFF — the catalogue's own comments
   * carry the four findings — so these tests select from a list with stand-in
   * entries added. That proves the SELECTION rules independently of which
   * companies are switched on this week; a test that only passed while one
   * particular company was enabled would stop testing anything the day that
   * changed.
   */
  const APPROVED = {
    ...COMPANY_CAREERS_CATALOGUE[0],
    sourceId: 'test-approved',
    enabled: true,
  };
  const SECOND = { ...APPROVED, sourceId: 'test-approved-2' };
  const catalogue = [...COMPANY_CAREERS_CATALOGUE, APPROVED, SECOND];
  const parse = (raw: string | undefined, options: object = {}) =>
    parseCompanyCareersConfig(raw, { ...options, catalogue });

  it('resolves an approved source id', () => {
    expect(parse('test-approved').map((source) => source.sourceId)).toEqual([
      'test-approved',
    ]);
  });

  it('resolves several, in the order configured', () => {
    expect(
      parse('test-approved-2, test-approved').map((source) => source.sourceId),
    ).toEqual(['test-approved-2', 'test-approved']);
  });

  it('refuses an unknown id', () => {
    expect(
      parseCompanyCareersConfig('acme-careers', { logger: quiet() }),
    ).toEqual([]);
  });

  it('refuses a raw URL — it is simply an unknown id', () => {
    // THE property that keeps an environment variable from choosing a fetch
    // destination. There is no branch that treats this value as a URL.
    for (const attempt of [
      'https://evil.test/careers',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      '//evil.test/careers',
      'test-approved,https://evil.test/x',
    ]) {
      const sources = parse(attempt, { logger: quiet() });
      expect(sources.every((source) => source.sourceId !== attempt)).toBe(true);
      for (const source of sources) {
        // Anything that DID resolve is a catalogue entry, with catalogue URLs.
        expect(source.indexUrl.startsWith('https://')).toBe(true);
        expect(catalogue).toContain(source);
      }
    }
  });

  it('refuses a source whose access review says no', () => {
    // Every real entry is reviewed off, and each is in the catalogue so its
    // REASON survives. Configuring one is not a way to switch the review off.
    expect(
      parseCompanyCareersConfig(
        COMPANY_CAREERS_CATALOGUE.map((source) => source.sourceId).join(','),
        { logger: quiet() },
      ),
    ).toEqual([]);
  });

  it('ignores a repeated id', () => {
    expect(parse('test-approved,test-approved')).toHaveLength(1);
  });

  it('is disabled by an empty value', () => {
    expect(parseCompanyCareersConfig('')).toEqual([]);
    expect(parseCompanyCareersConfig(undefined)).toEqual([]);
  });

  it('never echoes a rejected value into a log line', () => {
    const logger = new Logger('test');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    parseCompanyCareersConfig('https://secret.internal/admin?token=hunter2', {
      logger,
    });
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain('hunter2');
      expect(String(call[0])).not.toContain('secret.internal');
    }
  });
});

describe('every catalogue entry declares a reviewed, bounded access decision', () => {
  it.each(COMPANY_CAREERS_CATALOGUE.map((source) => [source.sourceId, source]))(
    '%s',
    (_id, source) => {
      const entry = source;
      expect(entry.allowedHosts.length).toBeGreaterThan(0);
      expect(entry.allowedPathPrefixes.length).toBeGreaterThan(0);
      expect(entry.access.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.access.robots.length).toBeGreaterThan(10);
      expect(entry.access.rendering.length).toBeGreaterThan(10);
      expect(entry.access.verdict.length).toBeGreaterThan(10);
      // Bounded by construction: no source may sweep without a ceiling.
      expect(entry.maxJobsPerSync).toBeGreaterThan(0);
      expect(entry.maxDetailRequests).toBeGreaterThanOrEqual(0);
      expect(entry.minRequestIntervalMs).toBeGreaterThanOrEqual(1_000);
      // The index URL must itself be fetchable under the source's own rules.
      expect(isFetchableForSource(entry, new URL(entry.indexUrl))).toBe(true);
    },
  );

  it('is entirely switched off, each entry saying why', () => {
    /*
     * The honest state after the first live run: four companies reviewed, and
     * not one of them publishing job facts a deterministic reader can use.
     */
    for (const source of COMPANY_CAREERS_CATALOGUE) {
      expect(source.enabled).toBe(false);
      expect(source.access.verdict).toMatch(/NOT enabled/);
    }
  });

  it('claims completeness nowhere', () => {
    /*
     * Not a coincidence and not caution — a measurement. Vercel's sitemap
     * lists 22 of 83 open roles; Linear's index renders one row per title and
     * seven titles are open twice. Neither enumerates a company's postings, so
     * neither may retire one.
     */
    for (const source of COMPANY_CAREERS_CATALOGUE) {
      expect(source.indexIsComplete).toBe(false);
    }
  });

  it('keeps the researched-and-rejected findings', () => {
    // A negative result is a result: without these, the next person researches
    // Gopuff again and rediscovers the same Cloudflare challenge.
    expect(REVIEWED_AND_REJECTED.length).toBeGreaterThanOrEqual(5);
    for (const entry of REVIEWED_AND_REJECTED) {
      expect(entry.finding.length).toBeGreaterThan(20);
    }
  });
});

describe('what a source may fetch', () => {
  it('allows its own host and declared paths', () => {
    expect(
      isFetchableForSource(vercel, new URL('https://vercel.com/careers/x-1')),
    ).toBe(true);
    expect(
      isFetchableForSource(vercel, new URL('https://vercel.com/sitemap.xml')),
    ).toBe(true);
  });

  it('refuses a path the source did not declare', () => {
    // Same host, undeclared path. Vanta's robots disallows /careers/paralegal
    // specifically, so path-blindness is not a theoretical failure.
    expect(
      isFetchableForSource(vercel, new URL('https://vercel.com/api/internal')),
    ).toBe(false);
    expect(isFetchableForSource(vercel, new URL('https://vercel.com/'))).toBe(
      false,
    );
  });

  it('refuses an attacker-registrable suffix', () => {
    // `endsWith('vercel.com')` accepts all of these. They are domains anyone
    // can register.
    for (const host of [
      'evilvercel.com',
      'vercel.com.evil.test',
      'notvercel.com',
    ]) {
      expect(
        isFetchableForSource(vercel, new URL(`https://${host}/careers/x`)),
      ).toBe(false);
    }
  });

  it('allows a true subdomain', () => {
    expect(
      isFetchableForSource(
        vercel,
        new URL('https://careers.vercel.com/careers/x'),
      ),
    ).toBe(true);
  });

  it('refuses another approved company', () => {
    // Being in the catalogue is not being in THIS source's allowlist.
    expect(
      isFetchableForSource(vercel, new URL('https://linear.app/careers/x')),
    ).toBe(false);
  });

  it('refuses a non-http scheme and credentials in the URL', () => {
    expect(
      isFetchableForSource(vercel, new URL('ftp://vercel.com/careers/x')),
    ).toBe(false);
    expect(
      isFetchableForSource(
        vercel,
        new URL('https://user:pass@vercel.com/careers/x'),
      ),
    ).toBe(false);
  });

  it('refuses the ATS it merely links to', () => {
    /*
     * The two-lists rule. A careers page pointing at Greenhouse is data to
     * hand a candidate, not permission to widen the crawl — and Greenhouse is
     * read through its official API by a different provider entirely.
     */
    expect(
      isFetchableForSource(
        vercel,
        new URL('https://job-boards.greenhouse.io/vercel/jobs/1'),
      ),
    ).toBe(false);
  });
});

describe('what a source may STORE as an apply link', () => {
  it('stores a link to its declared ATS', () => {
    expect(
      isStorableApplyUrl(
        vercel,
        new URL('https://job-boards.greenhouse.io/vercel/jobs/1'),
      ),
    ).toBe(true);
  });

  it('stores a link back to the company itself', () => {
    expect(
      isStorableApplyUrl(vercel, new URL('https://vercel.com/careers/x')),
    ).toBe(true);
  });

  it('refuses an unrelated destination', () => {
    expect(
      isStorableApplyUrl(vercel, new URL('https://tracker.evil.test/click')),
    ).toBe(false);
  });

  it('refuses a javascript: or credentialled URL', () => {
    expect(
      isStorableApplyUrl(
        vercel,
        new URL('https://a:b@job-boards.greenhouse.io/vercel/jobs/1'),
      ),
    ).toBe(false);
  });
});
