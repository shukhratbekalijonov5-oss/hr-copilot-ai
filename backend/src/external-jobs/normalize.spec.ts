import {
  countryCode,
  currencyCode,
  domainOf,
  enumValue,
  languageCodes,
  normalizeCompanyName,
  normalizeTitle,
  plainDescription,
  safeUrl,
  salaryAmount,
  tags,
  text,
  timestamp,
  EMPLOYMENT_TYPES,
  SENIORITY_LEVELS,
} from './normalize';
import { EXTERNAL_JOB_LIMITS } from './external-job.limits';
import {
  normalizeAshby,
  normalizeGreenhouse,
  normalizeLever,
  normalizeNinehire,
} from './testing/fake-providers';

describe('provider payloads are untrusted input', () => {
  it('rejects a URL that is not http(s)', () => {
    // A stored `javascript:` URL becomes an XSS the moment a template renders
    // it as an href, and this is the only place it can be stopped cheaply.
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>')).toBeNull();
    expect(safeUrl('file:///etc/passwd')).toBeNull();
    expect(safeUrl('/relative/path')).toBeNull();
    expect(safeUrl('https://boards.example.com/jobs/1')).toBe(
      'https://boards.example.com/jobs/1',
    );
  });

  it('rejects URLs carrying credentials', () => {
    expect(safeUrl('https://user:pass@example.com/job')).toBeNull();
  });

  it('caps an absurd URL rather than storing it', () => {
    expect(safeUrl(`https://e.com/${'a'.repeat(4000)}`)).toBeNull();
  });

  it('takes only ISO country CODES, never country names', () => {
    // "South Korea" → KR is a lookup this layer does not have. A guessed code
    // sends people to jobs in the wrong country; a null one costs a filter.
    expect(countryCode('kr')).toBe('KR');
    expect(countryCode('South Korea')).toBeNull();
    expect(countryCode('KOR')).toBeNull();
    expect(countryCode(42)).toBeNull();
  });

  it('takes only currencies this product can compare', () => {
    expect(currencyCode('krw')).toBe('KRW');
    expect(currencyCode('XYZ')).toBeNull();
    expect(currencyCode(null)).toBeNull();
  });

  it('treats an out-of-range salary as a parsing error, not a salary', () => {
    // Wrong is worse than missing: missing is neutral everywhere in this
    // product, wrong silently misranks the job forever.
    expect(salaryAmount(70_000)).toBe(70_000);
    expect(salaryAmount('40,000,000')).toBe(40_000_000);
    expect(salaryAmount(0)).toBeNull();
    expect(salaryAmount(-5)).toBeNull();
    expect(salaryAmount(9e15)).toBeNull();
    expect(salaryAmount('USD')).toBeNull();
  });

  it('keeps every salary below the INTEGER ceiling the column can hold', () => {
    expect(EXTERNAL_JOB_LIMITS.maxSalary).toBeLessThan(2_147_483_647);
  });

  it('maps an enum only on an exact member, never a nearest guess', () => {
    expect(enumValue('full_time', EMPLOYMENT_TYPES)).toBe('FULL_TIME');
    expect(enumValue('Full-Time', EMPLOYMENT_TYPES)).toBe('FULL_TIME');
    expect(enumValue('permanent', EMPLOYMENT_TYPES)).toBeNull();
    expect(enumValue('Sr.', SENIORITY_LEVELS)).toBeNull();
  });

  it('drops a timestamp that is obviously a unit mix-up', () => {
    expect(timestamp('2026-12-01T00:00:00Z')).toBeInstanceOf(Date);
    expect(timestamp('not a date')).toBeNull();
    // Seconds read as milliseconds land in 1970; milliseconds read as seconds
    // land in the far future. Both are bugs, not deadlines.
    expect(timestamp(0)).toBeNull();
    expect(timestamp('2200-01-01T00:00:00Z')).toBeNull();
  });

  it('bounds every list so one payload cannot fill the database', () => {
    expect(
      tags(
        Array.from({ length: 500 }, (_, i) => `skill-${i}`),
        100,
      ),
    ).toHaveLength(100);
    expect(languageCodes(['en', 'KO', 'not-a-code', 'ru'])).toEqual([
      'en',
      'ko',
      'ru',
    ]);
  });

  it('collapses whitespace and turns empty into null, never ""', () => {
    expect(text('  Backend   Engineer \n', 100)).toBe('Backend Engineer');
    expect(text('   ', 100)).toBeNull();
    expect(text(123, 100)).toBeNull();
  });
});

describe('provider HTML never reaches a renderable field', () => {
  it('strips script content out of a description entirely', () => {
    const description = plainDescription(
      '<div><p>Build things.</p><script>fetch("/steal")</script></div>',
      10_000,
    );

    expect(description).toContain('Build things.');
    expect(description).not.toContain('<script');
    expect(description).not.toContain('fetch("/steal")');
  });

  it('keeps no markup at all, so nothing downstream can trust any', () => {
    // The strategy is extraction, not sanitization: there is deliberately no
    // "safe HTML" field, because a field like that is one template away from
    // being rendered with dangerouslySetInnerHTML.
    const description = plainDescription(
      '<p onclick="steal()">Hello <img src=x onerror=alert(1)> world</p>',
      10_000,
    );

    expect(description).not.toContain('<');
    expect(description).not.toContain('onerror');
    expect(description).not.toContain('onclick');
    expect(description).toContain('Hello');
  });

  it('leaves plain text alone', () => {
    expect(plainDescription('Just a plain description.', 100)).toBe(
      'Just a plain description.',
    );
  });

  it('truncates rather than storing an unbounded description', () => {
    const huge = 'x'.repeat(EXTERNAL_JOB_LIMITS.maxDescriptionLength + 5_000);
    expect(
      plainDescription(huge, EXTERNAL_JOB_LIMITS.maxDescriptionLength),
    ).toHaveLength(EXTERNAL_JOB_LIMITS.maxDescriptionLength);
  });
});

describe('company and title folding', () => {
  it('folds the ways one employer writes its own name', () => {
    const forms = [
      'ABC Corp.',
      'ABC Corporation',
      'abc  corp',
      'ABC Corp, Inc.',
    ];
    const folded = new Set(forms.map(normalizeCompanyName));
    expect(folded.size).toBe(1);
  });

  it('does NOT fold two genuinely different companies together', () => {
    expect(normalizeCompanyName('ABC Labs')).not.toBe(
      normalizeCompanyName('ABC Bank'),
    );
  });

  it('folds the decoration one posting collects across sites', () => {
    expect(normalizeTitle('Backend Engineer (Remote) [Seoul]')).toBe(
      'backend engineer',
    );
    expect(normalizeTitle('Backend Engineer - Req #4821')).toBe(
      'backend engineer',
    );
  });

  it('keeps seniority in the title, because it is a different opening', () => {
    // Merging "Senior Backend Engineer" into "Backend Engineer" would hide one
    // of two real vacancies at the same company.
    expect(normalizeTitle('Senior Backend Engineer')).not.toBe(
      normalizeTitle('Backend Engineer'),
    );
  });

  it('reads a domain without being fooled by www', () => {
    expect(domainOf('https://www.abc.com/careers')).toBe('abc.com');
    expect(domainOf(null)).toBeNull();
  });
});

describe('four provider shapes reach ONE contract', () => {
  it('normalizes a Greenhouse-like posting', () => {
    const job = normalizeGreenhouse(
      {
        id: 4821,
        title: 'Backend Engineer',
        absolute_url: 'https://boards.greenhouse.io/abc/jobs/4821',
        content: '<p>Build <b>things</b>.</p>',
        offices: [{ name: 'Seoul, South Korea' }],
        metadata: [
          { name: 'Country', value: 'KR' },
          { name: 'Employment Type', value: 'Full-Time' },
          { name: 'Salary Min', value: '70000' },
          { name: 'Salary Currency', value: 'USD' },
          { name: 'Salary Period', value: 'YEARLY' },
        ],
      },
      'ABC Corp',
    )!;

    expect(job.provider).toBe('GREENHOUSE');
    expect(job.title).toBe('Backend Engineer');
    expect(job.city).toBe('Seoul');
    expect(job.countryCode).toBe('KR');
    expect(job.employmentType).toBe('FULL_TIME');
    expect(job.salaryMin).toBe(70_000);
    expect(job.currency).toBe('USD');
    expect(job.description).toContain('Build');
    expect(job.description).not.toContain('<b>');
  });

  it('normalizes a Lever-like posting', () => {
    const job = normalizeLever(
      {
        id: 'lever-1',
        text: 'Backend Engineer',
        hostedUrl: 'https://jobs.lever.co/abc/lever-1',
        applyUrl: 'https://jobs.lever.co/abc/lever-1/apply',
        descriptionPlain: 'Build things.',
        categories: { location: 'Seoul, KR', commitment: 'Full-time' },
        salaryRange: {
          min: 60_000,
          max: 80_000,
          currency: 'EUR',
          interval: 'YEARLY',
        },
      },
      { name: 'ABC Corp', url: 'https://abc.com' },
    )!;

    expect(job.provider).toBe('LEVER');
    expect(job.originalUrl).toContain('/apply');
    expect(job.employmentType).toBe('FULL_TIME');
    expect(job.currency).toBe('EUR');
  });

  it('normalizes an Ashby-like posting', () => {
    const job = normalizeAshby(
      {
        id: 'ashby-1',
        title: 'Backend Engineer',
        jobUrl: 'https://jobs.ashbyhq.com/abc/ashby-1',
        descriptionHtml: '<p>Build things.</p>',
        employmentType: 'FullTime',
        isRemote: true,
        address: {
          postalAddress: {
            addressCountry: 'DE',
            addressLocality: 'Berlin',
          },
        },
        compensation: {
          minValue: 65_000,
          currencyCode: 'EUR',
          interval: 'YEARLY',
        },
      },
      { name: 'ABC Corp' },
    )!;

    expect(job.provider).toBe('ASHBY');
    expect(job.workMode).toBe('REMOTE');
    expect(job.countryCode).toBe('DE');
    // "FullTime" is not a member of our vocabulary and is NOT bent into one.
    expect(job.employmentType).toBeNull();
  });

  it('normalizes a Ninehire-like posting — the shape least like the others', () => {
    const job = normalizeNinehire({
      recruitmentId: 'nh-9001',
      recruitmentTitle: '백엔드 엔지니어',
      detailUrl: 'https://ninehire.example/jobs/nh-9001',
      contentHtml: '<p>서버를 개발합니다.</p>',
      companyName: '에이비씨 주식회사',
      workplace: { country: 'KR', city: 'Seoul' },
      careerLevel: 'SENIOR',
      workType: 'FULL_TIME',
      annualSalary: { from: 40_000_000, to: 55_000_000, currency: 'KRW' },
      requiredLanguages: ['ko', 'en'],
      closingDate: '2026-12-31T00:00:00Z',
    })!;

    expect(job.provider).toBe('NINEHIRE');
    expect(job.countryCode).toBe('KR');
    expect(job.seniorityLevel).toBe('SENIOR');
    // KRW passes through in KRW. No Korean-specific money handling exists.
    expect(job.salaryMin).toBe(40_000_000);
    expect(job.currency).toBe('KRW');
    expect(job.payPeriod).toBe('YEARLY');
    expect(job.languageCodes).toEqual(['ko', 'en']);
    expect(job.expiresAt).toBeInstanceOf(Date);
  });

  it('every provider produces the SAME shape, with no provider fields left', () => {
    const jobs = [
      normalizeGreenhouse(
        {
          id: 1,
          title: 'A',
          absolute_url: 'https://boards.greenhouse.io/x/jobs/1',
          content: 'x',
        },
        'X',
      )!,
      normalizeLever(
        { id: 'l', text: 'A', hostedUrl: 'https://jobs.lever.co/x/l' },
        { name: 'X' },
      )!,
      normalizeAshby(
        { id: 'a', title: 'A', jobUrl: 'https://jobs.ashbyhq.com/x/a' },
        { name: 'X' },
      )!,
      normalizeNinehire({
        recruitmentId: 'n',
        recruitmentTitle: 'A',
        detailUrl: 'https://ninehire.example/jobs/n',
        companyName: 'X',
      })!,
    ];

    const shapes = jobs.map((job) => Object.keys(job).sort().join(','));
    expect(new Set(shapes).size).toBe(1);

    // Nothing provider-specific survives normalization. A downstream consumer
    // literally cannot branch on a vendor field, because there are none.
    for (const job of jobs) {
      const serialized = JSON.stringify(job);
      for (const leak of [
        'absolute_url',
        'hostedUrl',
        'jobUrl',
        'recruitmentId',
        'categories',
        'postalAddress',
        'metadata',
      ]) {
        expect(serialized).not.toContain(leak);
      }
    }
  });

  it('a posting with no usable identity is rejected, not half-stored', () => {
    expect(
      normalizeGreenhouse(
        { id: 1, title: '', absolute_url: 'nope', content: '' },
        'X',
      ),
    ).toBeNull();
    expect(
      normalizeNinehire({
        recruitmentId: 'n',
        recruitmentTitle: 'A',
        detailUrl: 'https://x.example/1',
        companyName: '   ',
      }),
    ).toBeNull();
  });

  it('unknown stays unknown across every provider', () => {
    const job = normalizeLever(
      { id: 'l', text: 'Engineer', hostedUrl: 'https://jobs.lever.co/x/l' },
      { name: 'X' },
    )!;

    expect(job.salaryMin).toBeNull();
    expect(job.currency).toBeNull();
    expect(job.workMode).toBeNull();
    expect(job.seniorityLevel).toBeNull();
    expect(job.countryCode).toBeNull();
    // Work authorization is never inferred from anything.
    expect(job.visaSponsorship).toBe('UNKNOWN');
    expect(job.existingWorkAuthorizationRequired).toBeNull();
    expect(job.eligibleVisaTypes).toEqual([]);
    // REMOTE eligibility unstated is UNKNOWN, never worldwide.
    expect(job.remoteCountriesAllowed).toEqual([]);
  });
});
