import { normalizeGreenhouseJob } from './greenhouse.normalize';
import type { GreenhouseJob } from './greenhouse.types';

/**
 * Normalization, against the shapes the live Job Board API actually returns.
 *
 * The fixtures below are trimmed copies of real responses from four public
 * boards, kept verbatim in the details that matter: `content` arrives
 * ENTITY-ENCODED, `min_cents` is in minor units, `offices[].location` is a
 * country NAME, `metadata` is sometimes `null`, and `company_name` is
 * sometimes absent. Every one of those was a wrong assumption that live data
 * corrected, so they are pinned here rather than paraphrased.
 */

const BOARD = { boardToken: 'examplecorp', label: 'Example Corp' };

/** Vercel-shaped: a structured office, entity-encoded HTML, a sales title. */
const WITH_OFFICE: GreenhouseJob = {
  id: 6136160004,
  internal_job_id: 5196261004,
  title: 'Account Executive, Commercial',
  absolute_url: 'https://job-boards.greenhouse.io/examplecorp/jobs/6136160004',
  updated_at: '2026-08-18T18:06:19-04:00',
  requisition_id: '1311',
  company_name: 'Example Corp',
  location: { name: 'Hybrid - London' },
  offices: [
    {
      id: 4091069004,
      name: 'Office - London',
      location: 'London, England, United Kingdom',
    },
  ],
  departments: [{ id: 4085775004, name: 'Account Executive' }],
  metadata: [
    {
      id: 1,
      name: 'Career Site Categories',
      value: 'Sales',
      value_type: 'single_select',
    },
  ],
  content:
    '&lt;div class=&quot;content-intro&quot;&gt;&lt;h2&gt;About us:&lt;/h2&gt;\n' +
    '&lt;p&gt;We build things.&lt;/p&gt;&lt;/div&gt;',
  application_deadline: null,
  pay_input_ranges: [],
};

/** Figma-shaped: a pay range in cents, no company_name, no offices. */
const WITH_PAY: GreenhouseJob = {
  id: 5426468004,
  title: 'Account Executive, Enterprise',
  absolute_url:
    'https://boards.greenhouse.io/examplecorp/jobs/5426468004?gh_jid=5426468004',
  location: { name: 'San Francisco, CA • New York, NY • United States' },
  metadata: null as never,
  pay_input_ranges: [
    {
      min_cents: 16500000,
      max_cents: 19000000,
      currency_type: 'USD',
      title: 'Annual Base Salary Range:',
      blurb: '<p><strong>Pay Transparency Disclosure</strong></p>',
    },
  ],
};

/** GitLab-shaped: a free-text location label, an office with null location. */
const REMOTE_LABEL: GreenhouseJob = {
  id: 8503792002,
  title: 'Account Executive - Italy',
  absolute_url: 'https://job-boards.greenhouse.io/examplecorp/jobs/8503792002',
  company_name: 'Example Corp',
  location: { name: 'Remote, Italy' },
  offices: [{ id: 4112149002, name: 'Italy', location: null }],
  content: '&lt;p&gt;We are hiring.&lt;/p&gt;',
};

describe('normalizeGreenhouseJob', () => {
  describe('identity', () => {
    it('keys on the board-qualified post id', () => {
      // A Greenhouse job id is unique within a board, not across boards, while
      // the (provider, sourceKey) constraint is global. Unqualified, two
      // boards colliding on an id would silently overwrite one real job with
      // another.
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.sourceJobId).toBe('examplecorp:6136160004');
    });

    it('does not key on internal_job_id', () => {
      // Live GitLab data shows two differently-titled posts sharing one
      // internal_job_id, so it does not identify a job post.
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.sourceJobId).not.toContain(
        String(WITH_OFFICE.internal_job_id),
      );
    });

    it('uses the board label when the payload omits company_name', () => {
      const job = normalizeGreenhouseJob(WITH_PAY, BOARD)!;
      expect(job.companyName).toBe('Example Corp');
    });

    it('rejects a posting with no title', () => {
      expect(
        normalizeGreenhouseJob({ ...WITH_OFFICE, title: '   ' }, BOARD),
      ).toBeNull();
    });

    it('rejects a posting with no usable URL', () => {
      expect(
        normalizeGreenhouseJob(
          { ...WITH_OFFICE, absolute_url: 'javascript:alert(1)' },
          BOARD,
        ),
      ).toBeNull();
    });

    it('rejects a posting with a non-numeric id', () => {
      expect(
        normalizeGreenhouseJob({ ...WITH_OFFICE, id: { nested: true } }, BOARD),
      ).toBeNull();
    });
  });

  describe('URLs', () => {
    it('uses absolute_url as both source and apply URL', () => {
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.sourceUrl).toBe(WITH_OFFICE.absolute_url);
      expect(job.originalUrl).toBe(WITH_OFFICE.absolute_url);
    });

    it('never derives a company domain from the ATS host', () => {
      // greenhouse.io is the ATS, not the employer. A domain taken from it
      // would give every Greenhouse company the same identity and merge them.
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.companyWebsiteUrl).toBeNull();
    });
  });

  describe('location', () => {
    it('resolves a country NAME from a structured office', () => {
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.countryCode).toBe('GB');
      expect(job.region).toBe('England');
      expect(job.city).toBe('London');
    });

    it('takes only the country from a free-text location label', () => {
      // "Remote, Italy" must not yield a city called "Remote".
      const job = normalizeGreenhouseJob(REMOTE_LABEL, BOARD)!;
      expect(job.countryCode).toBe('IT');
      expect(job.city).toBeNull();
      expect(job.region).toBeNull();
    });

    it('records no country when offices disagree', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_OFFICE,
          location: { name: 'Multiple' },
          offices: [
            { name: 'Berlin', location: 'Berlin, Berlin, Germany' },
            { name: 'Singapore', location: 'Singapore, North, Singapore' },
          ],
        },
        BOARD,
      )!;
      expect(job.countryCode).toBeNull();
      expect(job.city).toBeNull();
    });

    it('keeps the country but drops the city when one country has two offices', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_OFFICE,
          offices: [
            { name: 'Austin', location: 'Austin, Texas, United States' },
            { name: 'NYC', location: 'New York, New York, United States' },
          ],
        },
        BOARD,
      )!;
      expect(job.countryCode).toBe('US');
      expect(job.city).toBeNull();
    });

    it('yields nothing for a non-geographic office label', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_OFFICE,
          location: { name: 'EMEA' },
          offices: [{ name: 'EMEA', location: 'Remote - AMER' }],
        },
        BOARD,
      )!;
      expect(job.countryCode).toBeNull();
      expect(job.city).toBeNull();
    });

    it('does not invent a city from a multi-city free-text label', () => {
      const job = normalizeGreenhouseJob(WITH_PAY, BOARD)!;
      expect(job.city).toBeNull();
    });
  });

  describe('unknown stays unknown', () => {
    it('never infers a work mode from "Hybrid - London"', () => {
      // The label is a recruiter's prose, not a schema. Reading HYBRID out of
      // it would be trusted downstream and wrong the moment a board writes
      // "Flexible" for the same arrangement.
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.workMode).toBeNull();
    });

    it('never infers REMOTE from a "Remote, ..." label', () => {
      const job = normalizeGreenhouseJob(REMOTE_LABEL, BOARD)!;
      expect(job.workMode).toBeNull();
      expect(job.remoteCountriesAllowed).toEqual([]);
    });

    it('leaves employment type unknown — the API states none', () => {
      expect(
        normalizeGreenhouseJob(WITH_OFFICE, BOARD)!.employmentType,
      ).toBeNull();
    });

    it('leaves seniority unknown even for a title containing a level word', () => {
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, title: 'Senior Account Executive' },
        BOARD,
      )!;
      expect(job.seniorityLevel).toBeNull();
    });

    it('leaves work authorization unknown', () => {
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.visaSponsorship).toBe('UNKNOWN');
      expect(job.existingWorkAuthorizationRequired).toBeNull();
      expect(job.eligibleVisaTypes).toEqual([]);
    });

    it('does not turn departments into industries', () => {
      // "Account Executive" is an org unit, not a sector.
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.industries).toEqual([]);
      expect(job.skills).toEqual([]);
    });

    it('reads nothing out of board-specific metadata', () => {
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.employmentType).toBeNull();
      expect(job.seniorityLevel).toBeNull();
      expect(job.benefits).toEqual([]);
    });

    it('survives metadata being null rather than an array', () => {
      expect(normalizeGreenhouseJob(WITH_PAY, BOARD)).not.toBeNull();
    });
  });

  describe('salary', () => {
    it('converts min_cents/max_cents to major units', () => {
      // 16,500,000 cents is $165,000 — not sixteen million.
      const job = normalizeGreenhouseJob(WITH_PAY, BOARD)!;
      expect(job.salaryMin).toBe(165_000);
      expect(job.salaryMax).toBe(190_000);
      expect(job.currency).toBe('USD');
      expect(job.payPeriod).toBe('YEARLY');
    });

    it('invents nothing when the board publishes no range', () => {
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.salaryMin).toBeNull();
      expect(job.salaryMax).toBeNull();
      expect(job.currency).toBeNull();
      expect(job.payPeriod).toBeNull();
    });

    it('unions several ranges in one currency', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_PAY,
          pay_input_ranges: [
            { min_cents: 16500000, max_cents: 19000000, currency_type: 'USD' },
            { min_cents: 14000000, max_cents: 21000000, currency_type: 'USD' },
          ],
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBe(140_000);
      expect(job.salaryMax).toBe(210_000);
    });

    it('refuses to pick between ranges in different currencies', () => {
      // Converting here would put FX inside a provider, which is the one thing
      // the salary architecture forbids.
      const job = normalizeGreenhouseJob(
        {
          ...WITH_PAY,
          pay_input_ranges: [
            { min_cents: 16500000, max_cents: 19000000, currency_type: 'USD' },
            { min_cents: 20000000, max_cents: 24000000, currency_type: 'CAD' },
          ],
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.currency).toBeNull();
    });

    it('drops a range in a currency this product cannot compare', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_PAY,
          pay_input_ranges: [
            { min_cents: 100000, max_cents: 200000, currency_type: 'XYZ' },
          ],
        },
        BOARD,
      )!;
      expect(job.currency).toBeNull();
      expect(job.salaryMin).toBeNull();
    });

    it('drops a range whose floor exceeds its ceiling', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_PAY,
          pay_input_ranges: [
            { min_cents: 19000000, max_cents: 16500000, currency_type: 'USD' },
          ],
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.salaryMax).toBeNull();
    });

    it('ignores zero and negative amounts', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_PAY,
          pay_input_ranges: [
            { min_cents: 0, max_cents: -5, currency_type: 'USD' },
          ],
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.salaryMax).toBeNull();
    });

    it('parses nothing out of the disclosure blurb', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_PAY,
          pay_input_ranges: [
            {
              currency_type: 'USD',
              blurb: 'The base salary range is $300,000 to $400,000.',
            },
          ],
        },
        BOARD,
      )!;
      expect(job.salaryMin).toBeNull();
      expect(job.salaryMax).toBeNull();
    });
  });

  describe('description safety', () => {
    it('decodes and strips entity-encoded HTML into plain text', () => {
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.description).toContain('About us');
      expect(job.description).toContain('We build things');
      expect(job.description).not.toContain('<div');
      expect(job.description).not.toContain('&lt;');
      expect(job.description).not.toContain('content-intro');
    });

    it('removes a script hidden inside entity-encoded content', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_OFFICE,
          content:
            '&lt;p&gt;We are hiring a commercial account executive to join ' +
            'the London team.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
        },
        BOARD,
      )!;
      expect(job.description).toContain('commercial account executive');
      expect(job.description).not.toContain('alert(1)');
      expect(job.description).not.toContain('script');
    });

    it('removes a double-encoded script tag', () => {
      // One decode would leave `&lt;script&gt;` sitting in the database,
      // waiting for the first person who "fixes" the escaping downstream.
      const job = normalizeGreenhouseJob(
        {
          ...WITH_OFFICE,
          content:
            '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;' +
            'This is the real body of the job advertisement.',
        },
        BOARD,
      )!;
      expect(job.description).not.toContain('alert(1)');
      expect(job.description).toContain('real body of the job advertisement');
    });

    it('strips inline event handlers', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_OFFICE,
          content:
            '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;' +
            '&lt;div onclick=&quot;steal()&quot;&gt;We are hiring an account ' +
            'executive for the London office.&lt;/div&gt;',
        },
        BOARD,
      )!;
      expect(job.description).toContain('hiring an account executive');
      expect(job.description).not.toContain('onerror');
      expect(job.description).not.toContain('onclick');
      expect(job.description).not.toContain('alert(1)');
    });

    it('strips a javascript: URL', () => {
      const job = normalizeGreenhouseJob(
        {
          ...WITH_OFFICE,
          content:
            '&lt;a href=&quot;javascript:alert(1)&quot;&gt;Apply for this ' +
            'commercial role in London today&lt;/a&gt;',
        },
        BOARD,
      )!;
      expect(job.description).toContain('Apply for this commercial role');
      expect(job.description).not.toContain('javascript:');
      expect(job.description).not.toContain('alert(1)');
    });

    it('drops a description too short to be prose', () => {
      // The shared extractor treats three-word fragments as boilerplate. Real
      // ads are paragraphs; when this does fire, an empty description is the
      // safe outcome.
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, content: '&lt;p&gt;Hi&lt;/p&gt;' },
        BOARD,
      )!;
      expect(job.description).toBeNull();
    });

    it('is null when the board sent no content', () => {
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, content: undefined },
        BOARD,
      )!;
      expect(job.description).toBeNull();
    });
  });

  /**
   * The publication date, and the field that must never stand in for it.
   *
   * `first_published` is not described in Greenhouse's documentation — it
   * appears in the "Retrieve a job" example response and nowhere else — so the
   * mapping rests on the field name plus a live measurement: across 255
   * postings on two boards it was present on every one and never later than
   * `updated_at`. These tests pin both halves of that decision.
   */
  describe('publication date', () => {
    it('reads first_published as the employer publication date', () => {
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, first_published: '2026-04-17T05:58:03-04:00' },
        BOARD,
      )!;
      expect(job.employerPosted).toEqual({
        at: new Date('2026-04-17T09:58:03.000Z'),
        semantics: 'FIRST_PUBLISHED',
      });
    });

    it('NEVER falls back to updated_at', () => {
      // The whole point. `updated_at` moves whenever anyone edits a posting,
      // and 81% of live rows differ between the two — rendering it as "Posted"
      // would age a job by the date somebody fixed a typo in it.
      const job = normalizeGreenhouseJob(
        {
          ...WITH_OFFICE,
          first_published: undefined,
          updated_at: '2026-08-10T16:52:46-04:00',
        },
        BOARD,
      )!;
      expect(job.employerPosted).toBeNull();
    });

    it('is null when the board states nothing', () => {
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, first_published: null },
        BOARD,
      )!;
      expect(job.employerPosted).toBeNull();
    });

    it('refuses a malformed value rather than the whole posting', () => {
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, first_published: 'last Tuesday' },
        BOARD,
      )!;
      // The job still normalizes; only the unusable field is dropped.
      expect(job).not.toBeNull();
      expect(job.employerPosted).toBeNull();
      expect(job.title).toBe(WITH_OFFICE.title);
    });

    it('refuses a date the provider says is in the future', () => {
      const ahead = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, first_published: ahead },
        BOARD,
      )!;
      // "Posted in 3 weeks" is a defect a reader can see. No date is better.
      expect(job.employerPosted).toBeNull();
    });

    it('keeps a genuinely old posting', () => {
      // Age is not a reason to refuse a date. Only impossible values are.
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, first_published: '2021-04-27T20:13:45.158Z' },
        BOARD,
      )!;
      expect(job.employerPosted?.at.getUTCFullYear()).toBe(2021);
    });
  });

  describe('lifecycle hints', () => {
    it('treats a listed posting as open', () => {
      expect(normalizeGreenhouseJob(WITH_OFFICE, BOARD)!.closedAtSource).toBe(
        false,
      );
    });

    it('keeps a stated application deadline', () => {
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, application_deadline: '2026-12-31T00:00:00Z' },
        BOARD,
      )!;
      expect(job.expiresAt?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });

    it('rejects an implausible deadline', () => {
      const job = normalizeGreenhouseJob(
        { ...WITH_OFFICE, application_deadline: '2147-01-01T00:00:00Z' },
        BOARD,
      )!;
      expect(job.expiresAt).toBeNull();
    });
  });

  describe('general professions', () => {
    // The platform is not an engineering job board, and a normalizer that
    // only worked for software titles would silently narrow the catalogue.
    const professions = [
      'Associate Product Counsel, Safety',
      'Registered Nurse, Occupational Health',
      'Payroll Accountant',
      'Marketing Manager, Lifecycle',
      'Warehouse Operations Supervisor',
      'Senior Graphic Designer',
      'Customer Support Representative',
      '백엔드 개발자',
    ];

    it.each(professions)('normalizes %s', (title) => {
      const job = normalizeGreenhouseJob({ ...WITH_OFFICE, title }, BOARD);
      expect(job).not.toBeNull();
      expect(job!.title).toBe(title);
      expect(job!.countryCode).toBe('GB');
    });

    it('applies no profession filter of any kind', () => {
      const results = professions.map((title) =>
        normalizeGreenhouseJob({ ...WITH_OFFICE, title }, BOARD),
      );
      expect(results.filter(Boolean)).toHaveLength(professions.length);
    });
  });

  describe('provider vocabulary does not escape', () => {
    it('produces only contract fields', () => {
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      const serialized = JSON.stringify(job);
      for (const token of [
        'absolute_url',
        'internal_job_id',
        'pay_input_ranges',
        'min_cents',
        'requisition_id',
        'departments',
        'offices',
        'metadata',
        'data_compliance',
      ]) {
        expect(serialized).not.toContain(token);
      }
    });

    it('declares the official API as its access method', () => {
      const job = normalizeGreenhouseJob(WITH_OFFICE, BOARD)!;
      expect(job.provider).toBe('GREENHOUSE');
      expect(job.accessMethod).toBe('OFFICIAL_API');
    });
  });
});
