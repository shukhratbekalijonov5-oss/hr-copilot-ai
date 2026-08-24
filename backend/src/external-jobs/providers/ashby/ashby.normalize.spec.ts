import { normalizeAshbyJob, resolvePay } from './ashby.normalize';
import type { AshbyJob } from './ashby.types';

/**
 * Normalization, against the shapes the live public API returns.
 *
 * The fixtures are trimmed copies of real responses from seven public boards,
 * verbatim in the details that matter: `id` exists though the docs omit it,
 * `addressLocality` is often an empty string, `addressCountry` is sometimes
 * "European Union", `isRemote: true` sits beside `workplaceType: "Hybrid"`,
 * compensation mixes Salary with Bonus, Commission, EquityPercentage and
 * EquityCashValue, and market tiers routinely disagree — including on currency.
 */

const BOARD = { slug: 'exampleboard', label: 'Example Corp' };

/** Ashby-shaped: EU remote, salary + bonus + equity, many secondary places. */
const EU_REMOTE: AshbyJob = {
  id: '7458d4e9-da2e-47bd-98cb-adfda43d42b2',
  title: 'Engineering Manager - EU',
  department: 'Engineering',
  team: 'EMEA Engineering',
  employmentType: 'FullTime',
  workplaceType: 'Remote',
  isRemote: true,
  isListed: true,
  location: 'Remote - European Union',
  publishedAt: '2026-08-01T00:00:00.000Z',
  address: {
    postalAddress: {
      postalCode: '',
      addressRegion: '',
      addressCountry: 'European Union',
      addressLocality: '',
    },
  },
  secondaryLocations: [
    {
      location: 'Spain',
      address: {
        postalAddress: {
          addressRegion: 'Spain',
          addressCountry: 'Spain',
          addressLocality: 'Spain',
        },
      },
    },
    {
      location: 'Germany',
      address: {
        postalAddress: { addressCountry: 'Germany', addressLocality: '' },
      },
    },
    {
      location: 'Stockholm',
      address: {
        postalAddress: {
          addressRegion: 'Stockholm',
          addressCountry: 'Sweden',
          addressLocality: 'Stockholm',
        },
      },
    },
  ],
  descriptionPlain:
    'We are hiring an engineering manager to lead our EMEA platform team ' +
    'across several European countries.',
  jobUrl: 'https://jobs.ashbyhq.com/exampleboard/7458d4e9',
  applyUrl: 'https://jobs.ashbyhq.com/exampleboard/7458d4e9/application',
  compensation: {
    compensationTierSummary: '€110K – €185K • Offers Equity • Offers Bonus',
    scrapeableCompensationSalarySummary: '€110K - €185K',
    compensationTiers: [
      {
        id: 'f1284fac',
        title: 'EU',
        components: [
          {
            compensationType: 'EquityPercentage',
            interval: 'NONE',
            currencyCode: null,
            minValue: null,
            maxValue: null,
          },
          {
            compensationType: 'Bonus',
            interval: '1 YEAR',
            currencyCode: 'EUR',
            minValue: null,
            maxValue: null,
          },
          {
            compensationType: 'Salary',
            interval: '1 YEAR',
            currencyCode: 'EUR',
            minValue: 110000,
            maxValue: 185000,
          },
        ],
      },
    ],
    summaryComponents: [
      {
        compensationType: 'EquityPercentage',
        interval: 'NONE',
        currencyCode: null,
        minValue: null,
        maxValue: null,
      },
      {
        compensationType: 'Bonus',
        interval: '1 YEAR',
        currencyCode: 'EUR',
        minValue: null,
        maxValue: null,
      },
      {
        compensationType: 'Salary',
        interval: '1 YEAR',
        currencyCode: 'EUR',
        minValue: 110000,
        maxValue: 185000,
      },
    ],
  },
};

/** US hybrid with a concrete city. */
const US_HYBRID: AshbyJob = {
  id: 'abc-123',
  title: 'Senior Product Designer',
  employmentType: 'FullTime',
  workplaceType: 'Hybrid',
  // Live data really does pair these. See the work-mode block below.
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
  descriptionPlain:
    'We are hiring a senior product designer for the Bay Area team.',
  jobUrl: 'https://jobs.ashbyhq.com/exampleboard/abc-123',
  applyUrl: 'https://jobs.ashbyhq.com/exampleboard/abc-123/application',
};

function salaryOnly(
  over: Partial<{
    type: string;
    interval: string;
    currency: string | null;
    min: number | null;
    max: number | null;
  }> = {},
): AshbyJob {
  return {
    ...US_HYBRID,
    compensation: {
      summaryComponents: [
        {
          compensationType: over.type ?? 'Salary',
          interval: over.interval ?? '1 YEAR',
          currencyCode: over.currency === undefined ? 'USD' : over.currency,
          minValue: over.min === undefined ? 150000 : over.min,
          maxValue: over.max === undefined ? 210000 : over.max,
        },
      ],
    },
  };
}

describe('normalizeAshbyJob', () => {
  describe('identity', () => {
    it('keys on the board-qualified posting id', () => {
      expect(normalizeAshbyJob(EU_REMOTE, BOARD)!.sourceJobId).toBe(
        'exampleboard:7458d4e9-da2e-47bd-98cb-adfda43d42b2',
      );
    });

    it('uses the id rather than the title or the URL', () => {
      // Titles are not unique, array position is not stable across fetches,
      // and hashing a mutable description would change identity every time an
      // employer fixed a typo.
      const renamed = normalizeAshbyJob(
        { ...EU_REMOTE, title: 'Engineering Manager - Europe' },
        BOARD,
      )!;
      expect(renamed.sourceJobId).toBe(
        normalizeAshbyJob(EU_REMOTE, BOARD)!.sourceJobId,
      );
    });

    it('declares the provider and the official public API', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.provider).toBe('ASHBY');
      expect(job.accessMethod).toBe('OFFICIAL_API');
    });

    it.each([
      ['no title', { title: '  ' }],
      ['no job URL', { jobUrl: null }],
      ['a javascript: URL', { jobUrl: 'javascript:alert(1)' }],
      ['no id', { id: null }],
    ])('rejects a posting with %s', (_label, override) => {
      expect(
        normalizeAshbyJob({ ...EU_REMOTE, ...override }, BOARD),
      ).toBeNull();
    });
  });

  describe('URLs', () => {
    it('keeps the posting page and the application form separately', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.sourceUrl).toBe(EU_REMOTE.jobUrl);
      expect(job.originalUrl).toBe(EU_REMOTE.applyUrl);
    });

    it('falls back to the job URL when no apply URL is stated', () => {
      const job = normalizeAshbyJob(
        { ...EU_REMOTE, applyUrl: undefined },
        BOARD,
      )!;
      expect(job.originalUrl).toBe(EU_REMOTE.jobUrl);
    });

    it('never derives a company domain from the ATS host', () => {
      expect(normalizeAshbyJob(EU_REMOTE, BOARD)!.companyWebsiteUrl).toBeNull();
    });
  });

  describe('employment type', () => {
    it.each([
      ['FullTime', 'FULL_TIME'],
      ['PartTime', 'PART_TIME'],
      ['Intern', 'INTERNSHIP'],
      ['Contract', 'CONTRACT'],
      ['Temporary', 'TEMPORARY'],
    ])('maps the documented value %s', (employmentType, expected) => {
      const job = normalizeAshbyJob({ ...EU_REMOTE, employmentType }, BOARD)!;
      expect(job.employmentType).toBe(expected);
    });

    it.each(['Apprenticeship', 'Seasonal', 'Volunteer', '', null])(
      'leaves an unknown value (%s) null',
      (employmentType) => {
        const job = normalizeAshbyJob({ ...EU_REMOTE, employmentType }, BOARD)!;
        expect(job.employmentType).toBeNull();
      },
    );
  });

  describe('work mode', () => {
    it.each([
      ['Remote', 'REMOTE'],
      ['Hybrid', 'HYBRID'],
      ['OnSite', 'ONSITE'],
    ])('maps the documented workplaceType %s', (workplaceType, expected) => {
      const job = normalizeAshbyJob({ ...EU_REMOTE, workplaceType }, BOARD)!;
      expect(job.workMode).toBe(expected);
    });

    it('prefers workplaceType over isRemote when they disagree', () => {
      /*
       * Not a corner case: 231 of 584 live postings pair `isRemote: true` with
       * `workplaceType: "Hybrid"`, so the boolean plainly does not mean "fully
       * remote". The documented structured field wins, and no warning is
       * logged — at 40% of the catalogue that would be noise, not a signal.
       */
      const job = normalizeAshbyJob(US_HYBRID, BOARD)!;
      expect(US_HYBRID.isRemote).toBe(true);
      expect(job.workMode).toBe('HYBRID');
    });

    it('does not fall back to isRemote when workplaceType is absent', () => {
      const job = normalizeAshbyJob(
        { ...EU_REMOTE, workplaceType: undefined, isRemote: true },
        BOARD,
      )!;
      expect(job.workMode).toBeNull();
    });

    it('never claims remote work is worldwide', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.workMode).toBe('REMOTE');
      expect(job.remoteCountriesAllowed).toEqual([]);
    });

    it('keeps locations on a remote posting rather than blanking them', () => {
      // Remote does not erase where a job is offered.
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.additionalLocations.length).toBeGreaterThan(0);
    });
  });

  describe('primary location', () => {
    it('maps a structured postal address', () => {
      const job = normalizeAshbyJob(US_HYBRID, BOARD)!;
      expect(job.countryCode).toBe('US');
      expect(job.region).toBe('California');
      expect(job.city).toBe('San Francisco');
    });

    it.each([
      ['USA', 'US'],
      ['United States', 'US'],
      ['UK', 'GB'],
      ['United Kingdom', 'GB'],
      ['South Korea', 'KR'],
    ])('resolves the country alias %s', (addressCountry, expected) => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          address: { postalAddress: { addressCountry, addressLocality: 'X' } },
        },
        BOARD,
      )!;
      expect(job.countryCode).toBe(expected);
    });

    it('refuses "European Union", which is not a country', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.countryCode).toBeNull();
    });

    it('treats an empty-string locality as absent, not as a city', () => {
      // 119 of 584 live postings have exactly this.
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.city).toBeNull();
      expect(job.region).toBeNull();
    });

    it('does not record a city that is really the country said twice', () => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          address: {
            postalAddress: {
              addressCountry: 'Spain',
              addressRegion: 'Spain',
              addressLocality: 'Spain',
            },
          },
        },
        BOARD,
      )!;
      expect(job.countryCode).toBe('ES');
      expect(job.city).toBeNull();
      expect(job.region).toBeNull();
    });

    it('survives a missing address entirely', () => {
      const job = normalizeAshbyJob(
        { ...US_HYBRID, address: undefined },
        BOARD,
      )!;
      expect(job.countryCode).toBeNull();
      expect(job.city).toBeNull();
    });

    it('never turns a free-text "Remote" location into a city', () => {
      const job = normalizeAshbyJob(
        { ...US_HYBRID, location: 'Remote', address: undefined },
        BOARD,
      )!;
      expect(job.city).toBeNull();
    });
  });

  describe('secondary locations', () => {
    it('keeps every other place the posting is open in', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.additionalLocations).toEqual(
        expect.arrayContaining([
          { countryCode: 'ES', region: null, city: null },
          { countryCode: 'DE', region: null, city: null },
          // The region repeats the city, so it is dropped rather than stored
          // twice — see the region==city rule below.
          { countryCode: 'SE', region: null, city: 'Stockholm' },
        ]),
      );
    });

    it('drops a region that merely repeats the city', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      const stockholm = job.additionalLocations.find(
        (l) => l.city === 'Stockholm',
      );
      expect(stockholm).toEqual({
        countryCode: 'SE',
        region: null,
        city: 'Stockholm',
      });
    });

    it('does not collapse them into the primary location', () => {
      // The failure this prevents: pretending a three-country posting is only
      // in the first one, and excluding everyone else from it later.
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.countryCode).toBeNull();
      expect(job.additionalLocations).toHaveLength(3);
    });

    it('applies the same refusals as the primary address', () => {
      // "Spain" as a locality is the country repeated, not a city.
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      const spain = job.additionalLocations.find((l) => l.countryCode === 'ES');
      expect(spain).toEqual({ countryCode: 'ES', region: null, city: null });
    });

    it('deduplicates repeats and the primary location', () => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          secondaryLocations: [
            {
              address: {
                postalAddress: {
                  addressLocality: 'San Francisco',
                  addressRegion: 'California',
                  addressCountry: 'USA',
                },
              },
            },
            {
              address: {
                postalAddress: {
                  addressCountry: 'Canada',
                  addressLocality: '',
                },
              },
            },
            {
              address: {
                postalAddress: {
                  addressCountry: 'Canada',
                  addressLocality: '',
                },
              },
            },
          ],
        },
        BOARD,
      )!;
      expect(job.additionalLocations).toEqual([
        { countryCode: 'CA', region: null, city: null },
      ]);
    });

    it('drops entries that resolve to nothing at all', () => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          secondaryLocations: [
            { location: 'Remote', address: { postalAddress: {} } },
            { location: 'EMEA', address: undefined },
          ],
        },
        BOARD,
      )!;
      expect(job.additionalLocations).toEqual([]);
    });

    it('is empty when the posting states none', () => {
      expect(normalizeAshbyJob(US_HYBRID, BOARD)!.additionalLocations).toEqual(
        [],
      );
    });
  });

  describe('compensation: what becomes a salary', () => {
    it('maps a single stated salary component', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.salaryMin).toBe(110_000);
      expect(job.salaryMax).toBe(185_000);
      expect(job.currency).toBe('EUR');
      expect(job.payPeriod).toBe('YEARLY');
    });

    it('keeps major units exactly as stated', () => {
      const job = normalizeAshbyJob(salaryOnly(), BOARD)!;
      expect(job.salaryMin).toBe(150_000);
    });

    it('maps a monthly interval', () => {
      const job = normalizeAshbyJob(
        salaryOnly({ interval: '1 MONTH', min: 9_000, max: 11_000 }),
        BOARD,
      )!;
      expect(job.payPeriod).toBe('MONTHLY');
      expect(job.salaryMin).toBe(9_000);
    });

    it.each(['NONE', '2 WEEK', 'one-time', ''])(
      'keeps amounts but drops an unmappable interval (%s)',
      (interval) => {
        const job = normalizeAshbyJob(salaryOnly({ interval }), BOARD)!;
        expect(job.salaryMin).toBe(150_000);
        expect(job.payPeriod).toBeNull();
      },
    );

    it('keeps a one-sided range', () => {
      const job = normalizeAshbyJob(salaryOnly({ max: null }), BOARD)!;
      expect(job.salaryMin).toBe(150_000);
      expect(job.salaryMax).toBeNull();
    });
  });

  describe('compensation: what must NOT become a salary', () => {
    it.each(['Bonus', 'Commission', 'EquityPercentage', 'EquityCashValue'])(
      'refuses to treat %s as salary',
      (type) => {
        const job = normalizeAshbyJob(
          salaryOnly({ type, min: 50_000, max: 90_000 }),
          BOARD,
        )!;
        expect(job.salaryMin).toBeNull();
        expect(job.currency).toBeNull();
        expect(job.payPeriod).toBeNull();
      },
    );

    it('takes only the salary out of a mixed package', () => {
      // The live shape: equity and bonus alongside a real salary.
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.salaryMin).toBe(110_000);
      expect(job.salaryMax).toBe(185_000);
    });

    it('never lets a bonus currency stand in for a missing salary currency', () => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          compensation: {
            summaryComponents: [
              {
                compensationType: 'Bonus',
                interval: '1 YEAR',
                currencyCode: 'USD',
                minValue: 10_000,
                maxValue: 20_000,
              },
              {
                compensationType: 'Salary',
                interval: '1 YEAR',
                currencyCode: null,
                minValue: 150_000,
                maxValue: 210_000,
              },
            ],
          },
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.currency).toBeNull();
    });

    it('records nothing when only equity is offered', () => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          compensation: {
            summaryComponents: [
              {
                compensationType: 'EquityPercentage',
                interval: 'NONE',
                currencyCode: null,
                minValue: null,
                maxValue: null,
              },
            ],
          },
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(
        resolvePay({
          ...US_HYBRID,
          compensation: {
            summaryComponents: [
              { compensationType: 'EquityPercentage', interval: 'NONE' },
            ],
          },
        }).refusedReason,
      ).toBe('only non-salary compensation stated');
    });

    it('records nothing when no compensation is stated', () => {
      const job = normalizeAshbyJob(
        { ...US_HYBRID, compensation: undefined },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.currency).toBeNull();
    });

    it('refuses a salary with an amount but no currency', () => {
      const job = normalizeAshbyJob(salaryOnly({ currency: null }), BOARD)!;
      expect(job.salaryMin).toBeNull();
    });

    it('refuses a currency this product cannot compare', () => {
      const job = normalizeAshbyJob(salaryOnly({ currency: 'XYZ' }), BOARD)!;
      expect(job.currency).toBeNull();
      expect(job.salaryMin).toBeNull();
    });

    it('refuses a floor above its ceiling', () => {
      const job = normalizeAshbyJob(
        salaryOnly({ min: 210_000, max: 150_000 }),
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
    });
  });

  describe('compensation: market tiers', () => {
    function tiered(currencies: string[]): AshbyJob {
      return {
        ...US_HYBRID,
        compensation: {
          summaryComponents: [
            {
              compensationType: 'Salary',
              interval: '1 YEAR',
              currencyCode: currencies[0],
              minValue: 150_000,
              maxValue: 210_000,
            },
          ],
          compensationTiers: currencies.map((currencyCode, index) => ({
            title: `Zone ${index + 1}`,
            components: [
              {
                compensationType: 'Salary',
                interval: '1 YEAR',
                currencyCode,
                minValue: 150_000 - index * 20_000,
                maxValue: 210_000 - index * 20_000,
              },
            ],
          })),
        },
      };
    }

    it('accepts several tiers that share one currency', () => {
      /*
       * Ashby publishes its own roll-up across tiers, and in one currency that
       * roll-up is a true statement: the pay falls somewhere in that span. It
       * is also what the public posting displays, so it is a stated figure
       * rather than one this product synthesized.
       */
      const job = normalizeAshbyJob(tiered(['USD', 'USD', 'USD']), BOARD)!;
      expect(job.salaryMin).toBe(150_000);
      expect(job.currency).toBe('USD');
    });

    it('refuses tiers that span several currencies', () => {
      /*
       * The important refusal. 30 live postings state bands in two currencies
       * — "CAD 190–260k in Toronto, USD 150–210k in New York" — and Ashby's
       * summary keeps one and drops the other. Fine as a headline beside the
       * tiers; wrong as the single band this schema stores, because a Canadian
       * candidate would then be matched against a US figure with nothing to
       * show that had happened.
       */
      const job = normalizeAshbyJob(tiered(['USD', 'CAD']), BOARD)!;
      expect(job.salaryMin).toBeNull();
      expect(job.salaryMax).toBeNull();
      expect(job.currency).toBeNull();
      expect(resolvePay(tiered(['USD', 'CAD'])).refusedReason).toMatch(
        /span 2 currencies/,
      );
    });

    it('never blends amounts across tiers', () => {
      const job = normalizeAshbyJob(tiered(['USD', 'USD']), BOARD)!;
      // 150000/210000 is the stated summary, not min-of-one + max-of-another.
      expect(job.salaryMin).toBe(150_000);
      expect(job.salaryMax).toBe(210_000);
    });

    it('refuses when the roll-up disagrees with the tiers it summarizes', () => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          compensation: {
            summaryComponents: [
              {
                compensationType: 'Salary',
                interval: '1 YEAR',
                currencyCode: 'GBP',
                minValue: 150_000,
                maxValue: 210_000,
              },
            ],
            compensationTiers: [
              {
                title: 'US',
                components: [
                  {
                    compensationType: 'Salary',
                    interval: '1 YEAR',
                    currencyCode: 'USD',
                    minValue: 150_000,
                    maxValue: 210_000,
                  },
                ],
              },
            ],
          },
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
    });

    it('refuses two salary summaries', () => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          compensation: {
            summaryComponents: [
              {
                compensationType: 'Salary',
                interval: '1 YEAR',
                currencyCode: 'USD',
                minValue: 150_000,
                maxValue: 210_000,
              },
              {
                compensationType: 'Salary',
                interval: '1 YEAR',
                currencyCode: 'USD',
                minValue: 90_000,
                maxValue: 120_000,
              },
            ],
          },
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
    });

    it('parses nothing out of the summary prose', () => {
      const job = normalizeAshbyJob(
        {
          ...US_HYBRID,
          compensation: {
            compensationTierSummary: '$150K – $210K • Offers Equity',
            scrapeableCompensationSalarySummary: '$150K - $210K',
          },
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.currency).toBeNull();
    });
  });

  describe('description safety', () => {
    it('stores plain text from descriptionPlain', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.description).toContain('engineering manager');
      expect(job.description).not.toContain('<');
    });

    it('does not trust descriptionPlain to actually be plain', () => {
      // 13 of 584 live postings contained angle brackets in this field.
      const job = normalizeAshbyJob(
        {
          ...EU_REMOTE,
          descriptionPlain:
            '<p>We are hiring an engineering manager for the platform ' +
            'team.</p><script>alert(1)</script>',
        },
        BOARD,
      )!;
      expect(job.description).toContain('engineering manager');
      expect(job.description).not.toContain('alert(1)');
      expect(job.description).not.toContain('script');
    });

    it('falls back to the HTML field and strips it', () => {
      const job = normalizeAshbyJob(
        {
          ...EU_REMOTE,
          descriptionPlain: undefined,
          descriptionHtml:
            '<div><p>We are hiring an engineering manager for the EMEA ' +
            'platform team.</p></div>',
        },
        BOARD,
      )!;
      expect(job.description).toContain('engineering manager');
      expect(job.description).not.toContain('<div');
    });

    it('neutralizes entity-encoded markup', () => {
      const job = normalizeAshbyJob(
        {
          ...EU_REMOTE,
          descriptionPlain: undefined,
          descriptionHtml:
            '&lt;p&gt;We are hiring an engineering manager for the platform ' +
            'team.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
        },
        BOARD,
      )!;
      expect(job.description).toContain('engineering manager');
      expect(job.description).not.toContain('alert(1)');
      expect(job.description).not.toContain('&lt;');
    });

    it('strips inline event handlers', () => {
      const job = normalizeAshbyJob(
        {
          ...EU_REMOTE,
          descriptionPlain: undefined,
          descriptionHtml:
            '<img src=x onerror="alert(1)"><div onclick="steal()">We are ' +
            'hiring an engineering manager for the platform team.</div>',
        },
        BOARD,
      )!;
      expect(job.description).not.toContain('onerror');
      expect(job.description).not.toContain('onclick');
      expect(job.description).not.toContain('alert(1)');
    });

    it('strips a javascript: URL', () => {
      const job = normalizeAshbyJob(
        {
          ...EU_REMOTE,
          descriptionPlain: undefined,
          descriptionHtml:
            '<a href="javascript:alert(1)">Apply for this engineering ' +
            'manager role in Europe today</a>',
        },
        BOARD,
      )!;
      expect(job.description).not.toContain('javascript:');
      expect(job.description).not.toContain('alert(1)');
    });

    it('stores no raw HTML field for a renderer to trust', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(Object.keys(job)).not.toContain('descriptionHtml');
      expect(Object.keys(job)).toEqual(
        expect.not.arrayContaining(['html', 'rawHtml']),
      );
    });
  });

  describe('unknown stays unknown', () => {
    it('leaves seniority and work authorization unstated', () => {
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.seniorityLevel).toBeNull();
      expect(job.visaSponsorship).toBe('UNKNOWN');
      expect(job.eligibleVisaTypes).toEqual([]);
      expect(job.languageCodes).toEqual([]);
    });

    it('does not turn department or team into industries', () => {
      // "Engineering" / "EMEA Engineering" are org units, not sectors.
      const job = normalizeAshbyJob(EU_REMOTE, BOARD)!;
      expect(job.industries).toEqual([]);
      expect(job.skills).toEqual([]);
    });

    it('does not treat publishedAt as a deadline', () => {
      expect(normalizeAshbyJob(EU_REMOTE, BOARD)!.expiresAt).toBeNull();
    });

    it('treats a listed posting as open', () => {
      expect(normalizeAshbyJob(EU_REMOTE, BOARD)!.closedAtSource).toBe(false);
    });
  });

  describe('general professions', () => {
    const professions = [
      'Engineering Manager - EU',
      'Mid Market Account Executive - EMEA',
      'Marketing Operations Manager',
      'Senior Accountant, Revenue',
      'Warehouse Operations Lead',
      'Corporate Counsel, Commercial',
      'Senior Product Designer',
      'Customer Success Manager',
      'Registered Nurse, Telehealth',
      '백엔드 엔지니어',
    ];

    it.each(professions)('normalizes %s', (title) => {
      const job = normalizeAshbyJob({ ...US_HYBRID, title }, BOARD);
      expect(job).not.toBeNull();
      expect(job!.title).toBe(title);
    });

    it('applies no profession filter of any kind', () => {
      const results = professions.map((title) =>
        normalizeAshbyJob({ ...US_HYBRID, title }, BOARD),
      );
      expect(results.filter(Boolean)).toHaveLength(professions.length);
    });
  });

  describe('provider vocabulary does not escape', () => {
    it('produces only contract fields', () => {
      const serialized = JSON.stringify(
        normalizeAshbyJob(EU_REMOTE, BOARD),
      ).toLowerCase();
      for (const token of [
        'workplacetype',
        'isremote',
        'islisted',
        'compensationtier',
        'summarycomponents',
        'compensationtype',
        'equitypercentage',
        'secondarylocations',
        'postaladdress',
        'descriptionplain',
      ]) {
        expect(serialized).not.toContain(token);
      }
    });
  });
});

/**
 * The publication date.
 *
 * Ashby is the only provider in this catalogue whose date field is documented:
 * "ISO DateTime when the job was last published". LAST, not first — so the
 * claim records that, rather than pretending to a precision the API does not
 * offer.
 */
describe('normalizeAshbyJob publication date', () => {
  it('reads publishedAt as a LAST_PUBLISHED claim', () => {
    const job = normalizeAshbyJob(
      { ...EU_REMOTE, publishedAt: '2026-04-07T17:12:35.753+00:00' },
      BOARD,
    )!;
    expect(job.employerPosted).toEqual({
      at: new Date('2026-04-07T17:12:35.753Z'),
      semantics: 'LAST_PUBLISHED',
    });
  });

  it('is null when the field is absent', () => {
    const job = normalizeAshbyJob(
      { ...EU_REMOTE, publishedAt: undefined },
      BOARD,
    )!;
    expect(job.employerPosted).toBeNull();
  });

  it('refuses a malformed timestamp without losing the posting', () => {
    const job = normalizeAshbyJob(
      { ...EU_REMOTE, publishedAt: 'soon' },
      BOARD,
    )!;
    expect(job).not.toBeNull();
    expect(job.employerPosted).toBeNull();
  });

  it('normalizes a non-UTC offset to the same instant', () => {
    // The stored value is an instant, not a wall clock. Two sources writing
    // the same moment in different offsets must resolve to one timestamp.
    const utc = normalizeAshbyJob(
      { ...EU_REMOTE, publishedAt: '2026-04-07T17:12:35.000+00:00' },
      BOARD,
    )!;
    const offset = normalizeAshbyJob(
      { ...EU_REMOTE, publishedAt: '2026-04-07T19:12:35.000+02:00' },
      BOARD,
    )!;
    expect(offset.employerPosted?.at.getTime()).toBe(
      utc.employerPosted?.at.getTime(),
    );
  });
});
