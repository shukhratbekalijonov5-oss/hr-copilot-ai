import {
  isJobPosting,
  jobFromJsonLd,
  readJobPostings,
  readJsonLdObjects,
} from './jsonld';

/**
 * schema.org JobPosting, read defensively.
 *
 * Every fixture here is shaped after real markup — including the shapes that
 * are NOT jobs, which is the point. Eleven live careers pages were checked
 * while building this provider and not one published a JobPosting; every one
 * of them published `Organization`, `WebSite`, `Article` or `BreadcrumbList`.
 * A reader that treats "has JSON-LD" as "has a job" would have invented a
 * catalogue out of company boilerplate.
 */

const PAGE = 'https://acme.org/careers/backend-engineer';

/**
 * A page carrying JSON-LD, serialized the way a real site must.
 *
 * `</` is escaped to `<\/` — required, not decorative: a literal `</script>`
 * inside a script element ends the element, per the HTML tokenizer, so any
 * site embedding a job description with markup in it escapes the sequence or
 * its own page breaks. A fixture that skipped this would be testing a document
 * no browser and no server can produce.
 */
function page(...blocks: unknown[]): string {
  return `<!doctype html><html><head>${blocks
    .map(
      (block) =>
        `<script type="application/ld+json">${JSON.stringify(block).replace(
          /<\//g,
          '<\\/',
        )}</script>`,
    )
    .join('')}</head><body><h1>Careers</h1></body></html>`;
}

const JOB = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Backend Engineer',
  description: '<p>Build <b>services</b> that stay up.</p>',
  datePosted: '2026-08-01',
  validThrough: '2026-12-31T23:59:59Z',
  employmentType: 'FULL_TIME',
  url: 'https://boards.acme-ats.org/acme/jobs/42',
  hiringOrganization: {
    '@type': 'Organization',
    name: 'Acme Corporation',
    url: 'https://acme.org',
    sameAs: 'https://en.wikipedia.org/wiki/Acme',
  },
  jobLocation: [
    {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Seoul',
        addressCountry: 'KR',
      },
    },
    {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Busan',
        addressCountry: 'KR',
      },
    },
  ],
  baseSalary: {
    '@type': 'MonetaryAmount',
    currency: 'KRW',
    value: {
      '@type': 'QuantitativeValue',
      minValue: 60000000,
      maxValue: 90000000,
      unitText: 'YEAR',
    },
  },
};

describe('finding the JobPosting on a page', () => {
  it('reads a single object', () => {
    expect(readJobPostings(page(JOB))).toHaveLength(1);
  });

  it('reads a top-level array', () => {
    expect(readJobPostings(page([JOB, JOB]))).toHaveLength(2);
  });

  it('reads @graph', () => {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'acme.org' },
        { '@type': 'BreadcrumbList', itemListElement: [] },
        JOB,
      ],
    };
    expect(readJobPostings(page(graph))).toHaveLength(1);
  });

  it('ignores every schema type that is not a job', () => {
    // Exactly what the eleven researched sites actually publish.
    const html = page(
      { '@type': 'Organization', name: 'Ramp', url: 'https://ramp.com' },
      { '@type': 'WebSite', name: 'about.gitlab.com' },
      { '@type': 'Article', headline: 'Jobs and Career Opportunities' },
      { '@type': 'BreadcrumbList', itemListElement: [] },
      { '@type': 'FAQPage', mainEntity: [] },
    );
    expect(readJsonLdObjects(html).length).toBeGreaterThan(0);
    expect(readJobPostings(html)).toEqual([]);
  });

  it('accepts an array @type containing JobPosting', () => {
    expect(isJobPosting({ '@type': ['JobPosting', 'Thing'] })).toBe(true);
    expect(isJobPosting({ '@type': 'JobPostingAggregate' })).toBe(false);
    expect(isJobPosting({ '@type': 'Organization' })).toBe(false);
    expect(isJobPosting({})).toBe(false);
  });

  it('isolates a malformed block instead of losing the page', () => {
    // One broken marketing tag must not cost a company its whole listing.
    const html =
      `<script type="application/ld+json">{ not json ,,, }</script>` +
      page(JOB);
    expect(readJobPostings(html)).toHaveLength(1);
  });

  it('finds nothing on a page with no JSON-LD at all', () => {
    expect(
      readJobPostings('<html><body><h1>Careers</h1></body></html>'),
    ).toEqual([]);
  });
});

describe('mapping one JobPosting', () => {
  const job = jobFromJsonLd(readJobPostings(page(JOB))[0], PAGE);

  it('takes the title and the posting URL', () => {
    expect(job.title).toBe('Backend Engineer');
    expect(job.applyUrl).toBe('https://boards.acme-ats.org/acme/jobs/42');
    expect(job.pageUrl).toBe(PAGE);
  });

  it('strips HTML out of the description', () => {
    // `description` is HTML by specification, so it goes through the same
    // extractor everything else does.
    expect(job.description).toContain('Build');
    expect(job.description).not.toContain('<p>');
    expect(job.description).not.toContain('<b>');
  });

  it('takes the company name and its own URL', () => {
    expect(job.companyName).toBe('Acme Corporation');
    expect(job.companyWebsiteUrl).toBe('https://acme.org/');
  });

  it('never reads sameAs as the company website', () => {
    /*
     * `sameAs` is defined as a page that identifies the item, and is routinely
     * a Wikipedia or LinkedIn URL. Stored as a company domain it would make
     * every employer on Earth the same company.
     */
    const noUrl = jobFromJsonLd(
      readJobPostings(
        page({
          ...JOB,
          hiringOrganization: {
            '@type': 'Organization',
            name: 'Acme',
            sameAs: 'https://en.wikipedia.org/wiki/Acme',
          },
        }),
      )[0],
      PAGE,
    );
    expect(noUrl.companyWebsiteUrl).toBeNull();
  });

  it('keeps the primary location and every additional one', () => {
    expect(job.countryCode).toBe('KR');
    expect(job.city).toBe('Seoul');
    expect(job.additionalLocations).toEqual([
      { countryCode: 'KR', region: null, city: 'Busan' },
    ]);
  });

  it('accepts a country NAME as well as a code', () => {
    const named = jobFromJsonLd(
      readJobPostings(
        page({
          ...JOB,
          jobLocation: {
            '@type': 'Place',
            address: {
              addressLocality: 'Toronto',
              addressRegion: 'Ontario',
              addressCountry: 'Canada',
            },
          },
        }),
      )[0],
      PAGE,
    );
    expect(named.countryCode).toBe('CA');
    expect(named.city).toBe('Toronto');
    expect(named.region).toBe('Ontario');
  });

  it('takes validThrough as the deadline and never datePosted', () => {
    expect(job.validThrough).toBe('2026-12-31T23:59:59Z');
    const noDeadline = jobFromJsonLd(
      readJobPostings(page({ ...JOB, validThrough: undefined }))[0],
      PAGE,
    );
    expect(noDeadline.validThrough).toBeNull();
  });

  it('maps employmentType only when the posting gave ONE answer', () => {
    const one = (value: unknown) =>
      jobFromJsonLd(
        readJobPostings(page({ ...JOB, employmentType: value }))[0],
        PAGE,
      ).employmentTypeRaw;
    expect(one('FULL_TIME')).toBe('FULL_TIME');
    expect(one(['CONTRACTOR'])).toBe('CONTRACTOR');
    // Two answers is not an answer, and the column holds one.
    expect(one(['FULL_TIME', 'PART_TIME'])).toBeNull();
    expect(one(undefined)).toBeNull();
  });

  it('reads remote ONLY from jobLocationType', () => {
    const remote = jobFromJsonLd(
      readJobPostings(page({ ...JOB, jobLocationType: 'TELECOMMUTE' }))[0],
      PAGE,
    );
    expect(remote.workModeRaw).toBe('REMOTE');
    // A posting with no location is one that did not say where — not remote.
    const silent = jobFromJsonLd(
      readJobPostings(page({ ...JOB, jobLocation: undefined }))[0],
      PAGE,
    );
    expect(silent.workModeRaw).toBeNull();
    expect(silent.countryCode).toBeNull();
  });

  it("keeps a remote role's country restriction", () => {
    /*
     * Remote is not worldwide. A role open to the United States only is not
     * open to a candidate in Seoul, and dropping the restriction sends them to
     * apply for a job they cannot legally take.
     */
    const restricted = jobFromJsonLd(
      readJobPostings(
        page({
          ...JOB,
          jobLocationType: 'TELECOMMUTE',
          applicantLocationRequirements: [
            { '@type': 'Country', name: 'United States' },
            { '@type': 'Country', name: 'Canada' },
          ],
        }),
      )[0],
      PAGE,
    );
    expect(restricted.remoteCountriesAllowed.sort()).toEqual(['CA', 'US']);
  });

  it('leaves applicant countries EMPTY when none were stated', () => {
    // Empty is unknown geography everywhere downstream, never "anywhere".
    expect(job.remoteCountriesAllowed).toEqual([]);
  });
});

describe('baseSalary, only when unambiguous', () => {
  const salaryOf = (baseSalary: unknown) =>
    jobFromJsonLd(readJobPostings(page({ ...JOB, baseSalary }))[0], PAGE);

  it('reads a MonetaryAmount range', () => {
    const job = salaryOf(JOB.baseSalary);
    expect(job.salaryMin).toBe(60_000_000);
    expect(job.salaryMax).toBe(90_000_000);
    expect(job.currency).toBe('KRW');
    expect(job.payPeriodRaw).toBe('YEAR');
  });

  it('reads a single value as both ends', () => {
    // One number is what the employer stated: not a range with an open end.
    const job = salaryOf({
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: { '@type': 'QuantitativeValue', value: 120000, unitText: 'YEAR' },
    });
    expect(job.salaryMin).toBe(120_000);
    expect(job.salaryMax).toBe(120_000);
  });

  it('refuses an amount with no currency', () => {
    expect(
      salaryOf({
        '@type': 'MonetaryAmount',
        value: { '@type': 'QuantitativeValue', minValue: 100 },
      }).salaryMin,
    ).toBeNull();
  });

  it('refuses a ceiling with no floor', () => {
    // A maximum alone tells a candidate nothing about whether it pays enough.
    expect(
      salaryOf({
        '@type': 'MonetaryAmount',
        currency: 'USD',
        value: { '@type': 'QuantitativeValue', maxValue: 200000 },
      }).salaryMin,
    ).toBeNull();
  });

  it('refuses an encoding it does not recognize', () => {
    expect(salaryOf(150000).salaryMin).toBeNull();
    expect(salaryOf('competitive').salaryMin).toBeNull();
    expect(
      salaryOf({ '@type': 'PriceSpecification', price: 100000 }).salaryMin,
    ).toBeNull();
  });

  it('refuses a value outside the shared sanity bounds', () => {
    expect(
      salaryOf({
        '@type': 'MonetaryAmount',
        currency: 'USD',
        value: { '@type': 'QuantitativeValue', value: 9e12 },
      }).salaryMin,
    ).toBeNull();
  });

  it('never parses a salary out of prose', () => {
    // "$120k–$150k" in a description stays in the description.
    const prose = salaryOf(undefined);
    expect(prose.salaryMin).toBeNull();
    expect(prose.currency).toBeNull();
  });
});

describe('HTML safety', () => {
  it.each([
    ['<script>alert(1)</script>Real duties here that run to a full sentence.'],
    [
      '<img src=x onerror=alert(1)>Real duties here that run to a full sentence.',
    ],
    [
      '<div onclick="steal()">Real duties here that run to a full sentence.</div>',
    ],
    [
      '<a href="javascript:alert(1)">Real duties here that run for a sentence.</a>',
    ],
    ['&lt;script&gt;alert(1)&lt;/script&gt;Real duties, a full sentence long.'],
    [
      '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;Real duties, one sentence.',
    ],
  ])('neutralizes %s', (description) => {
    const job = jobFromJsonLd(
      readJobPostings(page({ ...JOB, description }))[0],
      PAGE,
    );
    const stored = job.description ?? '';
    expect(stored).not.toContain('<script');
    expect(stored).not.toContain('onerror');
    expect(stored).not.toContain('onclick');
    expect(stored).not.toContain('javascript:');
    expect(stored).not.toMatch(/<[a-z!/]/i);
  });

  it('refuses a non-http URL anywhere it would be stored', () => {
    const job = jobFromJsonLd(
      readJobPostings(
        page({
          ...JOB,
          url: 'javascript:alert(1)',
          hiringOrganization: {
            '@type': 'Organization',
            name: 'Acme',
            url: 'data:text/html,<script>',
          },
        }),
      )[0],
      PAGE,
    );
    expect(job.applyUrl).toBeNull();
    expect(job.companyWebsiteUrl).toBeNull();
  });
});

/**
 * `datePosted` versus `dateModified` — the one date pair in this whole audit
 * whose meanings are fixed by a specification rather than inferred.
 */
describe('publication date from JSON-LD', () => {
  it('reads datePosted', () => {
    const [node] = readJobPostings(page({ ...JOB, datePosted: '2026-08-01' }));
    expect(jobFromJsonLd(node, PAGE).datePosted).toBe('2026-08-01');
  });

  it('never reads dateModified as a posting date', () => {
    // A posting edited yesterday was not posted yesterday, and schema.org
    // distinguishes the two precisely so consumers do not confuse them.
    const [node] = readJobPostings(
      page({ ...JOB, datePosted: undefined, dateModified: '2026-08-20' }),
    );
    expect(jobFromJsonLd(node, PAGE).datePosted).toBeNull();
  });

  it('is null when the markup states neither', () => {
    const [node] = readJobPostings(page({ ...JOB, datePosted: undefined }));
    expect(jobFromJsonLd(node, PAGE).datePosted).toBeNull();
  });
});
