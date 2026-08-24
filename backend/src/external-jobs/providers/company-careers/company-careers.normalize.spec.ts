import { COMPANY_CAREERS_CATALOGUE } from './company-careers.catalogue';
import {
  normalizeCareersJob,
  statesMoreThanItsOwnLink,
} from './company-careers.normalize';
import { sourceKeyOf } from '../../dedupe';
import { urlIdentitiesOf } from '../../url-identity';
import type { CareersPageJob } from './company-careers.types';

const LINEAR = COMPANY_CAREERS_CATALOGUE.find(
  (source) => source.sourceId === 'linear-careers',
)!;
const VERCEL = COMPANY_CAREERS_CATALOGUE.find(
  (source) => source.sourceId === 'vercel-careers',
)!;

function page(over: Partial<CareersPageJob> = {}): CareersPageJob {
  return {
    pageUrl: 'https://linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076',
    title: 'Account Executive, Enterprise',
    applyUrl:
      'https://jobs.ashbyhq.com/Linear/069c4628-88d7-4e4d-b393-c996fc7f3076',
    locationText: 'North America',
    countryCode: null,
    region: null,
    city: null,
    additionalLocations: [],
    description: null,
    employmentTypeRaw: null,
    workModeRaw: null,
    remoteCountriesAllowed: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriodRaw: null,
    validThrough: null,
    datePosted: null,
    companyName: null,
    companyWebsiteUrl: null,
    ...over,
  };
}

describe('what a careers observation states', () => {
  const job = normalizeCareersJob(page(), LINEAR)!;

  it('keeps the company page and the apply link APART', () => {
    // Two different facts. Collapsing them loses one: the page alone sends a
    // candidate somewhere they cannot apply; the ATS link alone erases that
    // the employer publishes this role themselves.
    expect(job.sourceUrl).toBe(
      'https://linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076',
    );
    expect(job.originalUrl).toBe(
      'https://jobs.ashbyhq.com/Linear/069c4628-88d7-4e4d-b393-c996fc7f3076',
    );
  });

  it('states the company from the approved source, with its domain', () => {
    // The strongest company evidence available, and stated by the operator
    // rather than reduced from a host — so no public-suffix guessing exists
    // to get wrong on `company.co.uk`.
    expect(job.companyName).toBe('Linear');
    expect(job.companyWebsiteUrl).toBe('https://linear.app');
  });

  it('prefers a hiringOrganization the page actually published', () => {
    const stated = normalizeCareersJob(
      page({
        companyName: 'Linear Orbit, Inc.',
        companyWebsiteUrl: 'https://linear.app',
      }),
      LINEAR,
    )!;
    expect(stated.companyName).toBe('Linear Orbit, Inc.');
  });

  it('says nothing it was not told', () => {
    /*
     * A careers page states structured facts in prose, and prose is not a
     * field. Every one of these is left to the ATS sighting on the same job,
     * where "did not say" and "said no" are different answers.
     */
    expect(job.countryCode).toBeNull();
    expect(job.city).toBeNull();
    expect(job.workMode).toBeNull();
    expect(job.employmentType).toBeNull();
    expect(job.seniorityLevel).toBeNull();
    expect(job.salaryMin).toBeNull();
    expect(job.currency).toBeNull();
    expect(job.description).toBeNull();
    expect(job.visaSponsorship).toBe('UNKNOWN');
    expect(job.remoteCountriesAllowed).toEqual([]);
  });

  it('never reads seniority out of a title', () => {
    const senior = normalizeCareersJob(
      page({ title: 'Senior Staff Backend Engineer' }),
      LINEAR,
    )!;
    expect(senior.seniorityLevel).toBeNull();
    expect(senior.title).toBe('Senior Staff Backend Engineer');
  });

  it('never claims the employer closed anything', () => {
    // A careers page has no vocabulary for "this requisition is closed"; it
    // can only stop listing. Absence is the lifecycle's business.
    expect(job.closedAtSource).toBe(false);
  });

  it('is PUBLIC_ENDPOINT for a page and PUBLIC_FEED for a sitemap', () => {
    expect(job.accessMethod).toBe('PUBLIC_ENDPOINT');
    expect(
      normalizeCareersJob(
        page({ pageUrl: 'https://vercel.com/careers/x-1' }),
        VERCEL,
      )!.accessMethod,
    ).toBe('PUBLIC_FEED');
  });
});

describe('source identity', () => {
  it('is the company job URL, scoped to the source', () => {
    const job = normalizeCareersJob(page(), LINEAR)!;
    expect(job.sourceJobId).toBe(
      'linear-careers:linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076',
    );
    expect(sourceKeyOf(job)).toBe(job.sourceJobId);
  });

  it('survives a title change', () => {
    const before = normalizeCareersJob(page(), LINEAR)!;
    const after = normalizeCareersJob(
      page({ title: 'Enterprise Account Executive' }),
      LINEAR,
    )!;
    expect(after.sourceJobId).toBe(before.sourceJobId);
  });

  it('survives a description change', () => {
    const before = normalizeCareersJob(page(), LINEAR)!;
    const after = normalizeCareersJob(
      page({ description: 'Rewritten by the recruiter.' }),
      LINEAR,
    )!;
    expect(after.sourceJobId).toBe(before.sourceJobId);
  });

  it('is never the title alone', () => {
    const one = normalizeCareersJob(
      page({
        pageUrl:
          'https://linear.app/careers/aaaaaaaa-0000-0000-0000-000000000000',
      }),
      LINEAR,
    )!;
    const two = normalizeCareersJob(
      page({
        pageUrl:
          'https://linear.app/careers/bbbbbbbb-0000-0000-0000-000000000000',
      }),
      LINEAR,
    )!;
    // Same title, same location, two openings — and two identities.
    expect(one.sourceJobId).not.toBe(two.sourceJobId);
  });

  it('ignores tracking noise on the company URL', () => {
    const plain = normalizeCareersJob(page(), LINEAR)!;
    const tracked = normalizeCareersJob(
      page({
        pageUrl: `${page().pageUrl}?utm_source=newsletter#apply`,
      }),
      LINEAR,
    )!;
    expect(tracked.sourceJobId).toBe(plain.sourceJobId);
  });

  it('cannot collide across two configured companies', () => {
    const linear = normalizeCareersJob(
      page({ pageUrl: 'https://linear.app/careers/engineer' }),
      LINEAR,
    )!;
    const vercel = normalizeCareersJob(
      page({ pageUrl: 'https://vercel.com/careers/engineer' }),
      VERCEL,
    )!;
    expect(linear.sourceJobId).not.toBe(vercel.sourceJobId);
  });

  it('publishes both URLs for dedupe', () => {
    expect(urlIdentitiesOf(normalizeCareersJob(page(), LINEAR)!)).toEqual([
      'linear.app/careers/069c4628-88d7-4e4d-b393-c996fc7f3076',
      'jobs.ashbyhq.com/Linear/069c4628-88d7-4e4d-b393-c996fc7f3076',
    ]);
  });
});

describe('what is refused', () => {
  it('rejects a page with no title', () => {
    expect(normalizeCareersJob(page({ title: null }), LINEAR)).toBeNull();
    expect(normalizeCareersJob(page({ title: '   ' }), LINEAR)).toBeNull();
  });

  it('rejects a page with no usable URL', () => {
    expect(
      normalizeCareersJob(page({ pageUrl: 'javascript:alert(1)' }), LINEAR),
    ).toBeNull();
  });

  it('keeps a job whose page publishes no apply link but DOES state facts', () => {
    // Then the company page is both the sighting and the destination — a
    // company with no ATS, applying by email, is a real thing.
    const job = normalizeCareersJob(
      page({
        applyUrl: null,
        description: 'Own the growth funnel end to end.',
        countryCode: 'US',
        city: 'New York City',
      }),
      LINEAR,
    )!;
    expect(job.originalUrl).toBeNull();
    expect(job.sourceUrl).toContain('linear.app');
  });

  it('REFUSES a page that states only a title and its own link', () => {
    /*
     * Found live: neither vercel.com nor linear.app publishes its apply link
     * as an anchor, so both produced titles with nothing attached — 47 rows
     * that could never be tied to the ATS sighting of the same role, and could
     * only ever be duplicates of jobs already in the catalogue.
     */
    expect(normalizeCareersJob(page({ applyUrl: null }), LINEAR)).toBeNull();
    expect(statesMoreThanItsOwnLink(page({ applyUrl: null }))).toBe(false);
  });

  it('accepts on ANY single stated fact', () => {
    for (const evidence of [
      { applyUrl: 'https://jobs.ashbyhq.com/Linear/abc' },
      { description: 'Build the thing.' },
      { city: 'Seoul' },
      { countryCode: 'KR' },
      { employmentTypeRaw: 'FULL_TIME' },
      { workModeRaw: 'REMOTE' },
      { validThrough: '2026-12-31T00:00:00Z' },
      { salaryMin: 100_000 },
      { remoteCountriesAllowed: ['US'] },
      {
        additionalLocations: [
          { countryCode: 'CA', region: null, city: 'Toronto' },
        ],
      },
    ]) {
      expect(
        statesMoreThanItsOwnLink(page({ applyUrl: null, ...evidence })),
      ).toBe(true);
    }
  });

  it('drops a non-http apply link, and then has nothing left to state', () => {
    // The link is refused as a link AND does not count as evidence, so the
    // sighting is refused rather than stored as a bare title.
    expect(
      normalizeCareersJob(page({ applyUrl: 'javascript:alert(1)' }), LINEAR),
    ).toBeNull();
    // With one real fact alongside it, the job survives and the bad link does
    // not reach the database.
    const job = normalizeCareersJob(
      page({ applyUrl: 'javascript:alert(1)', city: 'Seoul' }),
      LINEAR,
    )!;
    expect(job.originalUrl).toBeNull();
    expect(job.city).toBe('Seoul');
  });
});

describe('structured facts, when a page publishes them', () => {
  it('takes a complete salary claim', () => {
    const job = normalizeCareersJob(
      page({
        salaryMin: 120_000,
        salaryMax: 150_000,
        currency: 'USD',
        payPeriodRaw: 'YEAR',
      }),
      LINEAR,
    )!;
    expect(job.salaryMin).toBe(120_000);
    expect(job.salaryMax).toBe(150_000);
    expect(job.currency).toBe('USD');
    expect(job.payPeriod).toBe('YEARLY');
  });

  it('drops the WHOLE claim when a part is missing', () => {
    /*
     * A more-trusted source publishing half a salary must not overwrite a
     * complete one. An amount with no period could be hourly or annual — a
     * factor of two thousand.
     */
    for (const partial of [
      { salaryMin: 120_000, currency: 'USD', payPeriodRaw: null },
      { salaryMin: 120_000, currency: null, payPeriodRaw: 'YEAR' },
      { salaryMin: null, currency: 'USD', payPeriodRaw: 'YEAR' },
      { salaryMin: 120_000, currency: 'ZZZ', payPeriodRaw: 'YEAR' },
    ]) {
      const job = normalizeCareersJob(page(partial), LINEAR)!;
      expect(job.salaryMin).toBeNull();
      expect(job.currency).toBeNull();
      expect(job.payPeriod).toBeNull();
    }
  });

  it('preserves the source currency exactly, converting nothing', () => {
    // Conversion is a read-time comparison through the shared FX pipeline, not
    // an ingestion step. The employer's number is a fact.
    const job = normalizeCareersJob(
      page({
        salaryMin: 60_000_000,
        currency: 'KRW',
        payPeriodRaw: 'YEAR',
      }),
      LINEAR,
    )!;
    expect(job.currency).toBe('KRW');
    expect(job.salaryMin).toBe(60_000_000);
  });

  it('maps employment type through the SHARED vocabulary', () => {
    // schema.org's tokens, mapped by the same table every provider uses.
    expect(
      normalizeCareersJob(page({ employmentTypeRaw: 'FULL_TIME' }), LINEAR)!
        .employmentType,
    ).toBe('FULL_TIME');
    expect(
      normalizeCareersJob(page({ employmentTypeRaw: 'CONTRACTOR' }), LINEAR)!
        .employmentType,
    ).toBe('CONTRACT');
    expect(
      normalizeCareersJob(page({ employmentTypeRaw: 'VOLUNTEER' }), LINEAR)!
        .employmentType,
    ).toBeNull();
  });

  it('takes a stated deadline and never invents one', () => {
    const job = normalizeCareersJob(
      page({ validThrough: '2099-01-01T00:00:00Z' }),
      LINEAR,
    )!;
    expect(job.expiresAt).toBeNull(); // beyond the shared sanity ceiling
    const soon = normalizeCareersJob(
      page({ validThrough: '2026-12-31T23:59:59Z' }),
      LINEAR,
    )!;
    expect(soon.expiresAt?.toISOString()).toBe('2026-12-31T23:59:59.000Z');
    expect(normalizeCareersJob(page(), LINEAR)!.expiresAt).toBeNull();
  });

  it('keeps a multi-location posting whole', () => {
    const job = normalizeCareersJob(
      page({
        countryCode: 'US',
        city: 'New York City',
        additionalLocations: [
          { countryCode: 'CA', region: null, city: 'Toronto' },
          { countryCode: 'US', region: 'CA', city: 'San Francisco' },
        ],
      }),
      LINEAR,
    )!;
    expect(job.city).toBe('New York City');
    expect(job.additionalLocations).toHaveLength(2);
  });
});

describe('no profession is privileged', () => {
  it.each([
    ['Backend Engineer'],
    ['Senior Accountant'],
    ['Marketing Manager'],
    ['Enterprise Account Executive'],
    ['Corporate Counsel'],
    ['Registered Nurse'],
    ['Warehouse Associate'],
    ['백엔드 개발자'],
    ['마케팅 매니저'],
    ['財務担当'],
    ['Développeur Full Stack'],
  ])('%s is ingested unchanged', (title) => {
    const job = normalizeCareersJob(page({ title }), LINEAR)!;
    // No filter, no romanization, no English taxonomy.
    expect(job.title).toBe(title);
  });
});
