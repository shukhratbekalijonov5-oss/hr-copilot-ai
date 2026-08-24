import {
  differsOnlyByCase,
  urlIdentitiesOf,
  urlIdentity,
} from './url-identity';
import type { NormalizedExternalJobInput } from './external-job.contract';

/**
 * When two URLs are the same application, and — more importantly — when they
 * are not.
 *
 * URL identity is the only evidence that merges a company careers page with
 * the ATS behind it, so both directions matter. Too loose and two live
 * requisitions collapse into one, which hides a job nobody can tell is
 * missing. Too tight and the merge this provider exists for never happens.
 */

describe('what is dropped as meaningless', () => {
  it('folds host case and strips www.', () => {
    expect(urlIdentity('https://WWW.Vercel.com/careers/x')).toBe(
      urlIdentity('https://vercel.com/careers/x'),
    );
  });

  it('ignores the scheme', () => {
    // http:// and https:// of one page are one page, not two jobs.
    expect(urlIdentity('http://vercel.com/careers/x')).toBe(
      urlIdentity('https://vercel.com/careers/x'),
    );
  });

  it('ignores a default port and a trailing slash', () => {
    expect(urlIdentity('https://vercel.com:443/careers/x/')).toBe(
      urlIdentity('https://vercel.com/careers/x'),
    );
  });

  it('ignores a fragment', () => {
    // Never sent to the server, so it cannot select different content.
    expect(urlIdentity('https://vercel.com/careers/x#apply')).toBe(
      urlIdentity('https://vercel.com/careers/x'),
    );
  });

  it('ignores known tracking parameters', () => {
    expect(
      urlIdentity('https://vercel.com/careers/x?utm_source=li&utm_medium=post'),
    ).toBe(urlIdentity('https://vercel.com/careers/x'));
    expect(urlIdentity('https://vercel.com/careers/x?gclid=abc')).toBe(
      urlIdentity('https://vercel.com/careers/x'),
    );
  });

  it('does not care about query parameter order', () => {
    expect(urlIdentity('https://a.org/j?b=2&a=1')).toBe(
      urlIdentity('https://a.org/j?a=1&b=2'),
    );
  });
});

describe('what is kept because it may be identity', () => {
  it('keeps a parameter that IS the job id', () => {
    /*
     * Live, from Figma's careers page:
     *   boards.greenhouse.io/figma/jobs/5220003004?gh_jid=5220003004
     * Strip "unimportant-looking" parameters wholesale and the requisition id
     * goes with them. Anything not KNOWN to be a campaign tag is kept.
     */
    expect(
      urlIdentity('https://boards.greenhouse.io/f/jobs/1?gh_jid=1'),
    ).not.toBe(urlIdentity('https://boards.greenhouse.io/f/jobs/1'));
    expect(urlIdentity('https://jobs.example.org/j?ashby_jid=abc')).not.toBe(
      urlIdentity('https://jobs.example.org/j'),
    );
  });

  it('keeps different paths apart', () => {
    expect(urlIdentity('https://jobs.lever.co/acme/aaa')).not.toBe(
      urlIdentity('https://jobs.lever.co/acme/bbb'),
    );
  });

  it('keeps the same posting on different hosts apart', () => {
    expect(urlIdentity('https://a.org/careers/x')).not.toBe(
      urlIdentity('https://b.org/careers/x'),
    );
  });

  it('PRESERVES path case', () => {
    /*
     * Live and unresolved: Linear's careers page publishes
     * jobs.ashbyhq.com/Linear/{id} while the Ashby API — asked for the board
     * under its configured lowercase name — answers jobs.ashbyhq.com/linear/{id}
     * for the same posting.
     *
     * Almost certainly one job. Folding path case anyway would merge genuinely
     * distinct paths on every case-sensitive server, forever, to fix one ATS
     * echoing a tenant name. RFC 3986 makes paths case-sensitive; this
     * respects that and records the near-miss instead.
     */
    expect(urlIdentity('https://jobs.ashbyhq.com/Linear/abc')).not.toBe(
      urlIdentity('https://jobs.ashbyhq.com/linear/abc'),
    );
    expect(
      differsOnlyByCase(
        urlIdentity('https://jobs.ashbyhq.com/Linear/abc')!,
        urlIdentity('https://jobs.ashbyhq.com/linear/abc')!,
      ),
    ).toBe(true);
  });

  it('does not call two genuinely different URLs a case difference', () => {
    expect(
      differsOnlyByCase(
        urlIdentity('https://jobs.ashbyhq.com/linear/aaa')!,
        urlIdentity('https://jobs.ashbyhq.com/linear/bbb')!,
      ),
    ).toBe(false);
  });
});

describe('what is refused outright', () => {
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>'],
    ['/careers/relative'],
    ['not a url'],
    [''],
    ['   '],
  ])('%s', (value) => {
    expect(urlIdentity(value)).toBeNull();
  });

  it('refuses null and non-strings', () => {
    expect(urlIdentity(null)).toBeNull();
    expect(urlIdentity(undefined)).toBeNull();
  });
});

describe('a sighting publishes BOTH of its URLs', () => {
  const sighting = (
    over: Partial<NormalizedExternalJobInput> = {},
  ): Pick<NormalizedExternalJobInput, 'sourceUrl' | 'originalUrl'> => ({
    sourceUrl: 'https://jobs.ashbyhq.com/ramp/abc',
    originalUrl: 'https://jobs.ashbyhq.com/ramp/abc/application',
    ...over,
  });

  it('claims the listing URL and the apply URL', () => {
    /*
     * Both, because providers disagree about which is which. Ashby's jobUrl is
     * the posting and applyUrl is that plus /application; a company page links
     * to the jobUrl. Publish only one and the match never happens.
     */
    expect(urlIdentitiesOf(sighting())).toEqual([
      'jobs.ashbyhq.com/ramp/abc',
      'jobs.ashbyhq.com/ramp/abc/application',
    ]);
  });

  it('deduplicates when a provider uses one URL for both', () => {
    expect(
      urlIdentitiesOf(
        sighting({
          sourceUrl: 'https://job-boards.greenhouse.io/v/jobs/1',
          originalUrl: 'https://job-boards.greenhouse.io/v/jobs/1',
        }),
      ),
    ).toEqual(['job-boards.greenhouse.io/v/jobs/1']);
  });

  it('drops an unusable URL without losing the usable one', () => {
    expect(
      urlIdentitiesOf(sighting({ originalUrl: 'javascript:alert(1)' })),
    ).toEqual(['jobs.ashbyhq.com/ramp/abc']);
  });
});
