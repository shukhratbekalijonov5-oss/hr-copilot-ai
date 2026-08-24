import { normalizeLeverPosting } from './lever.normalize';
import type { LeverPosting } from './lever.types';

/**
 * Normalization, against the shapes the live public Postings API returns.
 *
 * The fixtures are trimmed copies of real responses from three public Lever
 * sites, verbatim in the details that matter: `salaryRange` amounts are MAJOR
 * units (the opposite of Greenhouse), `workplaceType` reads `onsite` rather
 * than the documented `on-site`, `country` is already ISO alpha-2,
 * `commitment` is tenant free text ("Full Time/Part Time", "Temp Full-time"),
 * and `descriptionPlain` deliberately EXCLUDES the `lists` sections where the
 * requirements live.
 */

const SITE = { slug: 'examplesite', label: 'Example Corp' };

/** Match Group-shaped: Korean title, hybrid, contract, ISO country. */
const KOREAN: LeverPosting = {
  id: '7fca4a70-174c-41a2-b44b-7ff1cb9422e7',
  text: 'Accountant (1년 6개월 계약직)',
  categories: {
    commitment: 'Contract',
    department: 'Hyperconnect',
    location: 'Seoul, South Korea',
    team: 'Management',
    allLocations: ['Seoul, South Korea'],
  },
  country: 'KR',
  workplaceType: 'hybrid',
  createdAt: 1787203369315,
  descriptionPlain:
    'Role Overview\nThe Accountant will support procurement and accounts ' +
    'payable operations for the APAC region, with a focus on purchase order ' +
    'management and supplier invoice processing.',
  lists: [
    {
      text: 'Required Qualifications',
      content:
        '<div><li><p>Minimum 2 years of experience in accounts payable, ' +
        'procurement operations or finance operations.</p></li></div>',
    },
  ],
  additionalPlain: '#hpcnt\n',
  hostedUrl:
    'https://jobs.lever.co/examplesite/7fca4a70-174c-41a2-b44b-7ff1cb9422e7',
  applyUrl:
    'https://jobs.lever.co/examplesite/7fca4a70-174c-41a2-b44b-7ff1cb9422e7/apply',
};

/** Salaried, US, full-time, per-year. */
const SALARIED: LeverPosting = {
  id: 'abc-123',
  text: 'Android Engineer III',
  categories: {
    commitment: 'Full-time',
    location: 'New York, New York',
    allLocations: ['New York, New York'],
  },
  country: 'US',
  workplaceType: 'onsite',
  salaryRange: {
    interval: 'per-year-salary',
    currency: 'USD',
    min: 150000,
    max: 180000,
  },
  salaryDescription:
    '<p>The base salary range for this role is $150k–$180k.</p>',
  descriptionPlain: 'We are hiring an Android engineer for the New York team.',
  hostedUrl: 'https://jobs.lever.co/examplesite/abc-123',
  applyUrl: 'https://jobs.lever.co/examplesite/abc-123/apply',
};

describe('normalizeLeverPosting', () => {
  describe('identity', () => {
    it('keys on the site-qualified posting id', () => {
      // A Lever posting id is unique within a site, not across sites, while
      // (provider, sourceKey) is global.
      expect(normalizeLeverPosting(KOREAN, SITE)!.sourceJobId).toBe(
        'examplesite:7fca4a70-174c-41a2-b44b-7ff1cb9422e7',
      );
    });

    it('declares the provider and the official public API', () => {
      const job = normalizeLeverPosting(KOREAN, SITE)!;
      expect(job.provider).toBe('LEVER');
      expect(job.accessMethod).toBe('OFFICIAL_API');
    });

    it('names the company from the configured site label', () => {
      expect(normalizeLeverPosting(KOREAN, SITE)!.companyName).toBe(
        'Example Corp',
      );
    });

    it('falls back to the slug when no label is configured', () => {
      const job = normalizeLeverPosting(KOREAN, {
        slug: 'examplesite',
        label: '',
      })!;
      expect(job.companyName).toBe('examplesite');
    });

    it.each([
      ['no title', { text: '  ' }],
      ['no hosted URL', { hostedUrl: null }],
      ['a javascript: URL', { hostedUrl: 'javascript:alert(1)' }],
      ['no id', { id: null }],
    ])('rejects a posting with %s', (_label, override) => {
      expect(
        normalizeLeverPosting({ ...KOREAN, ...override }, SITE),
      ).toBeNull();
    });
  });

  describe('URLs', () => {
    it('keeps the hosted page and the apply form separately', () => {
      const job = normalizeLeverPosting(KOREAN, SITE)!;
      expect(job.sourceUrl).toBe(KOREAN.hostedUrl);
      expect(job.originalUrl).toBe(KOREAN.applyUrl);
    });

    it('falls back to the hosted URL when no apply URL is given', () => {
      const job = normalizeLeverPosting(
        { ...KOREAN, applyUrl: undefined },
        SITE,
      )!;
      expect(job.originalUrl).toBe(KOREAN.hostedUrl);
    });

    it('never derives a company domain from the ATS host', () => {
      // jobs.lever.co is the ATS, not the employer. A domain from it would
      // give every Lever company the same identity and merge them all.
      expect(normalizeLeverPosting(KOREAN, SITE)!.companyWebsiteUrl).toBeNull();
    });
  });

  describe('employment type', () => {
    it.each([
      ['Full-time', 'FULL_TIME'],
      ['Full Time', 'FULL_TIME'],
      ['Part-time', 'PART_TIME'],
      ['Part Time', 'PART_TIME'],
      ['Contract', 'CONTRACT'],
      ['Internship', 'INTERNSHIP'],
      ['Temporary', 'TEMPORARY'],
    ])('maps the stated commitment %s', (commitment, expected) => {
      const job = normalizeLeverPosting(
        { ...KOREAN, categories: { ...KOREAN.categories, commitment } },
        SITE,
      )!;
      expect(job.employmentType).toBe(expected);
    });

    it.each([
      // Two answers, so no answer.
      'Full Time/Part Time',
      // Temporary AND full-time; the schema holds one.
      'Temp Full-time',
      // A contract duration, not an employment type.
      'Fixed Term',
      // Not INTERNSHIP: different status, pay and law.
      'Apprenticeship',
      'Seasonal',
      '',
    ])(
      'refuses to force the unmappable commitment %s into the enum',
      (commitment) => {
        const job = normalizeLeverPosting(
          { ...KOREAN, categories: { ...KOREAN.categories, commitment } },
          SITE,
        )!;
        expect(job.employmentType).toBeNull();
      },
    );

    it('is null when no commitment is stated', () => {
      const job = normalizeLeverPosting(
        { ...KOREAN, categories: { ...KOREAN.categories, commitment: null } },
        SITE,
      )!;
      expect(job.employmentType).toBeNull();
    });
  });

  describe('work mode', () => {
    it.each([
      ['remote', 'REMOTE'],
      ['hybrid', 'HYBRID'],
      // The documented spelling and the one live data actually uses.
      ['on-site', 'ONSITE'],
      ['onsite', 'ONSITE'],
    ])('maps the stated workplaceType %s', (workplaceType, expected) => {
      const job = normalizeLeverPosting({ ...KOREAN, workplaceType }, SITE)!;
      expect(job.workMode).toBe(expected);
    });

    it('treats "unspecified" as unstated rather than guessing', () => {
      const job = normalizeLeverPosting(
        { ...KOREAN, workplaceType: 'unspecified' },
        SITE,
      )!;
      expect(job.workMode).toBeNull();
    });

    it('is null when the field is absent', () => {
      const job = normalizeLeverPosting(
        { ...KOREAN, workplaceType: undefined },
        SITE,
      )!;
      expect(job.workMode).toBeNull();
    });

    it('never reads a work mode out of a location label', () => {
      // "New York, NY or Remote" is prose. The structured field is the only
      // thing allowed to state an arrangement.
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          workplaceType: undefined,
          categories: {
            ...KOREAN.categories,
            location: 'New York, NY or Remote',
            allLocations: ['New York, NY or Remote'],
          },
        },
        SITE,
      )!;
      expect(job.workMode).toBeNull();
    });

    it('never claims remote work is worldwide', () => {
      const job = normalizeLeverPosting(
        { ...KOREAN, workplaceType: 'remote' },
        SITE,
      )!;
      expect(job.workMode).toBe('REMOTE');
      expect(job.remoteCountriesAllowed).toEqual([]);
    });
  });

  describe('salary', () => {
    it('keeps major units exactly as posted', () => {
      // 150000 is $150,000 — Lever does NOT send cents, unlike Greenhouse.
      const job = normalizeLeverPosting(SALARIED, SITE)!;
      expect(job.salaryMin).toBe(150_000);
      expect(job.salaryMax).toBe(180_000);
      expect(job.currency).toBe('USD');
      expect(job.payPeriod).toBe('YEARLY');
    });

    it('never converts currency at ingestion', () => {
      const job = normalizeLeverPosting(
        {
          ...SALARIED,
          salaryRange: { ...SALARIED.salaryRange, currency: 'CAD' },
        },
        SITE,
      )!;
      expect(job.currency).toBe('CAD');
      expect(job.salaryMin).toBe(150_000);
    });

    it('keeps the amounts but drops an interval the enum cannot express', () => {
      // "bi-week-salary" is live Lever data. Annualising it would turn a
      // stated fact into a derived one and store it as the employer's word.
      const job = normalizeLeverPosting(
        {
          ...SALARIED,
          salaryRange: { ...SALARIED.salaryRange, interval: 'bi-week-salary' },
        },
        SITE,
      )!;
      expect(job.salaryMin).toBe(150_000);
      expect(job.payPeriod).toBeNull();
    });

    it.each(['one-time', 'per-week-salary', 'per-quarter-salary', 'weird'])(
      'leaves the period null for the unmappable interval %s',
      (interval) => {
        const job = normalizeLeverPosting(
          { ...SALARIED, salaryRange: { ...SALARIED.salaryRange, interval } },
          SITE,
        )!;
        expect(job.payPeriod).toBeNull();
      },
    );

    it('invents nothing when the posting states no salary', () => {
      const job = normalizeLeverPosting(KOREAN, SITE)!;
      expect(job.salaryMin).toBeNull();
      expect(job.salaryMax).toBeNull();
      expect(job.currency).toBeNull();
      expect(job.payPeriod).toBeNull();
    });

    it('drops a range with no currency rather than defaulting to USD', () => {
      const job = normalizeLeverPosting(
        {
          ...SALARIED,
          salaryRange: {
            min: 150000,
            max: 180000,
            interval: 'per-year-salary',
          },
        },
        SITE,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.currency).toBeNull();
    });

    it('drops a currency this product cannot compare', () => {
      const job = normalizeLeverPosting(
        {
          ...SALARIED,
          salaryRange: { ...SALARIED.salaryRange, currency: 'XYZ' },
        },
        SITE,
      )!;
      expect(job.currency).toBeNull();
      expect(job.salaryMin).toBeNull();
    });

    it('drops a range whose floor exceeds its ceiling', () => {
      const job = normalizeLeverPosting(
        {
          ...SALARIED,
          salaryRange: { ...SALARIED.salaryRange, min: 180000, max: 150000 },
        },
        SITE,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.salaryMax).toBeNull();
    });

    it('keeps a one-sided range', () => {
      const job = normalizeLeverPosting(
        {
          ...SALARIED,
          salaryRange: {
            min: 150000,
            currency: 'USD',
            interval: 'per-year-salary',
          },
        },
        SITE,
      )!;
      expect(job.salaryMin).toBe(150_000);
      expect(job.salaryMax).toBeNull();
    });

    it('parses nothing out of the salary prose', () => {
      const job = normalizeLeverPosting(
        { ...SALARIED, salaryRange: undefined },
        SITE,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.currency).toBeNull();
    });
  });

  describe('location', () => {
    it('uses the country Lever states, already ISO alpha-2', () => {
      expect(normalizeLeverPosting(KOREAN, SITE)!.countryCode).toBe('KR');
    });

    it('reads the city from a "City, Country" label', () => {
      const job = normalizeLeverPosting(KOREAN, SITE)!;
      expect(job.city).toBe('Seoul');
      // "South Korea" is the country, not a region.
      expect(job.region).toBeNull();
    });

    it('reads city and region from "City, Region"', () => {
      const job = normalizeLeverPosting(SALARIED, SITE)!;
      expect(job.city).toBe('New York');
      expect(job.region).toBe('New York');
      expect(job.countryCode).toBe('US');
    });

    it('records no city for a posting open in several places', () => {
      // The schema holds one city and the truth is two. Precision is lost;
      // nothing false is stored.
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          categories: {
            ...KOREAN.categories,
            location: 'New York, New York',
            allLocations: ['New York, New York', 'Los Angeles, California'],
          },
        },
        SITE,
      )!;
      expect(job.city).toBeNull();
      expect(job.region).toBeNull();
      expect(job.countryCode).toBe('KR');
    });

    it.each([
      'New York, NY or Remote',
      'Remote',
      'Remote - EMEA',
      'London / Berlin',
      'Multiple locations',
      'APAC',
    ])('records no city for the ambiguous label %s', (location) => {
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          categories: {
            ...KOREAN.categories,
            location,
            allLocations: [location],
          },
        },
        SITE,
      )!;
      expect(job.city).toBeNull();
    });

    it('does not call a bare country name a city', () => {
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          country: 'SG',
          categories: {
            ...KOREAN.categories,
            location: 'Singapore',
            allLocations: ['Singapore'],
          },
        },
        SITE,
      )!;
      expect(job.countryCode).toBe('SG');
      expect(job.city).toBeNull();
    });

    it('keeps a bare city name', () => {
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          country: 'JP',
          categories: {
            ...KOREAN.categories,
            location: 'Tokyo',
            allLocations: ['Tokyo'],
          },
        },
        SITE,
      )!;
      expect(job.city).toBe('Tokyo');
      expect(job.countryCode).toBe('JP');
    });

    it('survives a missing country field', () => {
      const job = normalizeLeverPosting({ ...KOREAN, country: null }, SITE)!;
      expect(job.countryCode).toBeNull();
      expect(job.city).toBe('Seoul');
    });

    it('refuses a country value that is not a code or a known name', () => {
      for (const country of ['Freedonia', 'EMEA', 'Remote', 42, '']) {
        const job = normalizeLeverPosting({ ...KOREAN, country }, SITE)!;
        expect(job.countryCode).toBeNull();
      }
    });

    it('trusts a two-letter code as a code, as internal vacancies do', () => {
      // The dictionary lists the countries job boards actually name; it is
      // not the full ISO register. Rejecting codes absent from it would drop
      // real countries (MC, LI, AD), which is the worse error — so a
      // well-formed alpha-2 passes through exactly as it does for a Vacancy.
      expect(
        normalizeLeverPosting({ ...KOREAN, country: 'MC' }, SITE)!.countryCode,
      ).toBe('MC');
    });
  });

  describe('description', () => {
    it('includes the list sections the description leaves out', () => {
      // Verified against live data: `descriptionPlain` stops before the
      // requirements, which live in a separate array.
      const job = normalizeLeverPosting(KOREAN, SITE)!;
      expect(job.description).toContain('Role Overview');
      expect(job.description).toContain('Required Qualifications');
      expect(job.description).toContain('Minimum 2 years of experience');
    });

    it('stores plain text, never markup', () => {
      const job = normalizeLeverPosting(KOREAN, SITE)!;
      expect(job.description).not.toContain('<div');
      expect(job.description).not.toContain('<li');
      expect(job.description).not.toContain('&lt;');
    });

    it('removes a script hidden in a list section', () => {
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          lists: [
            {
              text: 'Requirements',
              content:
                '<p>You will build and maintain our payment services.</p>' +
                '<script>alert(1)</script>',
            },
          ],
        },
        SITE,
      )!;
      expect(job.description).toContain('payment services');
      expect(job.description).not.toContain('alert(1)');
      expect(job.description).not.toContain('script');
    });

    it('removes entity-encoded markup', () => {
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          descriptionPlain: undefined,
          description:
            '&lt;p&gt;We are hiring an accountant for the Seoul office ' +
            'team.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
          lists: [],
        },
        SITE,
      )!;
      expect(job.description).toContain('accountant for the Seoul office');
      expect(job.description).not.toContain('alert(1)');
      expect(job.description).not.toContain('&lt;');
    });

    it('strips inline event handlers', () => {
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          lists: [
            {
              text: 'About',
              content:
                '<img src=x onerror="alert(1)">' +
                '<div onclick="steal()">We are hiring for the Seoul team.</div>',
            },
          ],
        },
        SITE,
      )!;
      expect(job.description).not.toContain('onerror');
      expect(job.description).not.toContain('onclick');
      expect(job.description).not.toContain('alert(1)');
    });

    it('strips a javascript: URL', () => {
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          lists: [
            {
              text: 'Apply',
              content:
                '<a href="javascript:alert(1)">Apply for this accounting ' +
                'role in Seoul today</a>',
            },
          ],
        },
        SITE,
      )!;
      expect(job.description).not.toContain('javascript:');
      expect(job.description).not.toContain('alert(1)');
    });

    it('is null when the posting carries no text at all', () => {
      const job = normalizeLeverPosting(
        {
          ...KOREAN,
          descriptionPlain: undefined,
          description: undefined,
          lists: [],
          additionalPlain: undefined,
        },
        SITE,
      )!;
      expect(job.description).toBeNull();
    });
  });

  describe('unknown stays unknown', () => {
    it('leaves seniority, visa and languages unstated', () => {
      const job = normalizeLeverPosting(SALARIED, SITE)!;
      expect(job.seniorityLevel).toBeNull();
      expect(job.visaSponsorship).toBe('UNKNOWN');
      expect(job.existingWorkAuthorizationRequired).toBeNull();
      expect(job.eligibleVisaTypes).toEqual([]);
      expect(job.languageCodes).toEqual([]);
    });

    it('does not read seniority out of a title', () => {
      const job = normalizeLeverPosting(
        { ...SALARIED, text: 'Senior Account Executive' },
        SITE,
      )!;
      expect(job.seniorityLevel).toBeNull();
    });

    it('does not turn teams or departments into industries', () => {
      // "Hyperconnect" and "Management" are org units, not sectors.
      const job = normalizeLeverPosting(KOREAN, SITE)!;
      expect(job.industries).toEqual([]);
      expect(job.skills).toEqual([]);
      expect(job.benefits).toEqual([]);
    });

    it('states no deadline, because the public API exposes none', () => {
      expect(normalizeLeverPosting(KOREAN, SITE)!.expiresAt).toBeNull();
    });

    it('treats a listed posting as open', () => {
      // The public API returns published postings only, so being here IS the
      // evidence. Closure comes from absence, not from this flag.
      expect(normalizeLeverPosting(KOREAN, SITE)!.closedAtSource).toBe(false);
    });
  });

  describe('general professions', () => {
    const professions = [
      'Accountant (1년 6개월 계약직)',
      'Compounding Pharmacy Technician - Romeoville',
      'Beer Store Manager, Pittsburgh',
      'Director, Compounding Operations',
      'Brand Strategy Manager',
      'Associate Manager, Culture & Content',
      'Registered Nurse',
      'Android Engineer III',
    ];

    it.each(professions)('normalizes %s', (title) => {
      const job = normalizeLeverPosting({ ...KOREAN, text: title }, SITE);
      expect(job).not.toBeNull();
      expect(job!.title).toBe(title);
    });

    it('applies no profession filter of any kind', () => {
      const results = professions.map((title) =>
        normalizeLeverPosting({ ...KOREAN, text: title }, SITE),
      );
      expect(results.filter(Boolean)).toHaveLength(professions.length);
    });
  });

  describe('provider vocabulary does not escape', () => {
    it('produces only contract fields', () => {
      // The apply URL is genuinely a jobs.lever.co link and must survive —
      // it is where a candidate is sent. What must not survive is Lever's
      // FIELD vocabulary.
      const serialized = JSON.stringify(normalizeLeverPosting(SALARIED, SITE));
      for (const token of [
        'hostedUrl',
        'applyUrl',
        'salaryRange',
        'workplaceType',
        'categories',
        'commitment',
        'allLocations',
        'descriptionPlain',
        'per-year-salary',
      ]) {
        expect(serialized.toLowerCase()).not.toContain(token.toLowerCase());
      }
    });
  });
});

/**
 * Lever states no publication date, and this is what that costs.
 *
 * The payload carries `createdAt`, an epoch-millisecond number present on every
 * live posting and absent from Lever's official field reference entirely. It
 * describes when the posting RECORD was created, which precedes publication by
 * an unknown amount. Mapping it would put a confident "Posted 3 days ago" on
 * screen from a number nobody has defined — and a reader cannot tell an
 * invented date from a real one.
 */
describe('normalizeLeverPosting publication date', () => {
  it('never claims a publication date', () => {
    expect(normalizeLeverPosting(KOREAN, SITE)!.employerPosted).toBeNull();
  });

  it('does not read createdAt, however plausible the value looks', () => {
    const job = normalizeLeverPosting(
      { ...KOREAN, createdAt: 1787203369315 },
      SITE,
    )!;
    expect(job.employerPosted).toBeNull();
  });
});
