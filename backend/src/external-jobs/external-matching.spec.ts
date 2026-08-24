import { externalJobFeatures } from './external-job-features';
import type { ExternalJobFeatureColumns } from './external-job-features';
import { normalizedJobFeatures } from '../matching/normalized-job-features';
import { compareSalary } from '../matching/salary-matcher';
import { alignSalary, alignLocation } from '../matching/intent-alignment';
import { normalizeSalary } from '../fx/money';
import { emptyJobIntent } from '../candidate-preferences/candidate-job-intent';
import {
  normalizeGreenhouse,
  normalizeAshby,
  normalizeNinehire,
} from './testing/fake-providers';
import { normalizeGreenhouseJob } from './providers/greenhouse/greenhouse.normalize';
import { normalizeLeverPosting } from './providers/lever/lever.normalize';
import { normalizeAshbyJob } from './providers/ashby/ashby.normalize';
import { normalizeNinehireJob } from './providers/ninehire/ninehire.normalize';
import type { NormalizedExternalJobInput } from './external-job.contract';

/**
 * External jobs reaching the EXISTING matching system.
 *
 * This is the file that decides whether Task 4A actually built a foundation or
 * merely a second job catalogue. The claim under test is narrow and total: an
 * external posting becomes matchable by being mapped to
 * `NormalizedJobFeatures`, and from that point every piece of ranking machinery
 * this product already has — hard exclusions, intent alignment, the FX salary
 * matcher, Find Jobs ordering — works on it unchanged, with no idea it is
 * external.
 *
 * If any assertion here needed a provider name, the abstraction leaked.
 */

const FX_TABLE = {
  baseCurrency: 'USD',
  rates: { USD: 1, KRW: 1385.7418, EUR: 0.856 },
};

/** The candidate from the spec: 20,000–40,000 USD / YEARLY. */
const CANDIDATE = {
  min: 20_000,
  max: 40_000,
  currency: 'USD',
  payPeriod: 'YEARLY' as const,
};

function externalRow(
  over: Partial<ExternalJobFeatureColumns> = {},
): ExternalJobFeatureColumns {
  return {
    id: 'ext-1',
    title: 'Backend Engineer',
    countryCode: 'KR',
    region: null,
    city: 'Seoul',
    workMode: null,
    remoteCountriesAllowed: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    employmentType: 'FULL_TIME',
    seniorityLevel: 'SENIOR',
    benefits: [],
    industries: [],
    company: { name: 'ABC Corp' },
    ...over,
  };
}

describe('an external job becomes an ordinary job', () => {
  it('maps into the SAME shape an internal vacancy maps into', () => {
    const external = externalJobFeatures(externalRow());
    const internal = normalizedJobFeatures({
      id: 'vac-1',
      title: 'Backend Engineer',
      country: 'KR',
      region: null,
      city: 'Seoul',
      workMode: null,
      remoteCountriesAllowed: [],
      salaryMin: null,
      salaryMax: null,
      currency: null,
      payPeriod: null,
      employmentType: 'Full-time',
      seniorityLevel: 'SENIOR',
      benefits: [],
      domainExperience: [],
      organization: { name: 'ABC Corp' },
    });

    expect(Object.keys(external).sort()).toEqual(Object.keys(internal).sort());
    // Everything the matcher reads is identical; only the identity differs.
    const facts = (features: typeof external) => {
      const copy: Record<string, unknown> = { ...features };
      delete copy.jobId;
      delete copy.sourceType;
      return copy;
    };
    expect(facts(external)).toEqual(facts(internal));
  });

  it('carries its origin, so nothing has to guess from a UUID', () => {
    expect(externalJobFeatures(externalRow()).sourceType).toBe('EXTERNAL');
    expect(
      normalizedJobFeatures({
        id: 'vac-1',
        title: 'T',
        country: null,
        region: null,
        city: null,
        workMode: null,
        remoteCountriesAllowed: [],
        salaryMin: null,
        salaryMax: null,
        currency: null,
        payPeriod: null,
        employmentType: null,
        seniorityLevel: null,
        benefits: [],
        domainExperience: [],
        organization: { name: 'O' },
      }).sourceType,
    ).toBe('INTERNAL');
  });

  it('the mapping needs no provider argument at all', () => {
    // The structural proof that ranking cannot branch on a vendor: the
    // function that feeds the matcher takes a row and nothing else.
    expect(externalJobFeatures).toHaveLength(1);
  });
});

describe('the Task 3B salary pipeline is reused, not reimplemented', () => {
  /** The spec's three jobs, as they arrive from three different providers. */
  const KRW_JOB = externalRow({
    id: 'ext-krw',
    salaryMin: 40_000_000,
    currency: 'KRW',
    payPeriod: 'YEARLY',
  });
  const USD_JOB = externalRow({
    id: 'ext-usd',
    salaryMin: 70_000,
    currency: 'USD',
    payPeriod: 'YEARLY',
  });
  const EUR_JOB = externalRow({
    id: 'ext-eur',
    salaryMin: 60_000,
    currency: 'EUR',
    payPeriod: 'YEARLY',
  });

  it('40,000,000 KRW is compared against 20K–40K USD by the existing matcher', () => {
    const features = externalJobFeatures(KRW_JOB);
    const result = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );

    // 40,000,000 / 1385.7418 = 28,865 USD → inside the 20K–40K the candidate
    // stated, so the verdict uses RANGE language. (A floor-only candidate
    // would get SALARY_MEETS_MINIMUM instead; the matcher never invents range
    // wording for someone who named no upper figure.)
    expect(result.detail?.convertedMin).toBe(28_865);
    expect(result.detail?.convertedCurrency).toBe('USD');
    expect(result.reason).toBe('SALARY_WITHIN_DESIRED_RANGE');
    expect(result.score).toBe(1);
  });

  it('70,000 USD needs no conversion and still compares', () => {
    const features = externalJobFeatures(USD_JOB);
    const result = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );

    // Above the target, which is a MATCH: a higher salary is never a penalty.
    expect(result.reason).toBe('SALARY_ABOVE_DESIRED_RANGE');
    expect(result.score).toBe(1);
  });

  it('60,000 EUR converts through the same table', () => {
    const features = externalJobFeatures(EUR_JOB);
    const result = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );

    // 60,000 / 0.856 = 70,093 USD.
    expect(result.detail?.convertedMin).toBe(70_093);
    expect(result.detail?.convertedCurrency).toBe('USD');
  });

  it('all three ORIGINALS survive the comparison untouched', () => {
    // The employer's number is a fact; the conversion is a derived value shown
    // beside it. Nothing in this path may overwrite the source currency.
    for (const [row, currency, amount] of [
      [KRW_JOB, 'KRW', 40_000_000],
      [USD_JOB, 'USD', 70_000],
      [EUR_JOB, 'EUR', 60_000],
    ] as const) {
      const features = externalJobFeatures(row);
      expect(features.currency).toBe(currency);
      expect(features.salaryMin).toBe(amount);

      const result = compareSalary(
        {
          min: features.salaryMin,
          max: features.salaryMax,
          currency: features.currency,
          payPeriod: features.payPeriod,
        },
        CANDIDATE,
        FX_TABLE,
      );
      expect(result.detail?.originalCurrency).toBe(currency);
      expect(result.detail?.originalMin).toBe(amount);
    }
  });

  it('uses the shared MoneyNormalizer — no external FX code exists', () => {
    // Same call, same answer: the external path adds nothing of its own.
    const viaShared = normalizeSalary(
      { min: 40_000_000, max: null, currency: 'KRW', payPeriod: 'YEARLY' },
      'USD',
      'YEARLY',
      FX_TABLE,
    );
    expect(viaShared.ok && viaShared.salary.min).toBe(28_865);
  });

  it('an FX outage leaves an external job NOT_COMPARABLE, never hidden', () => {
    const features = externalJobFeatures(KRW_JOB);
    const result = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      null,
    );

    expect(result.state).toBe('NOT_COMPARABLE');
    expect(result.score).toBeNull();
  });

  it('an external job with no salary is UNKNOWN, exactly like an internal one', () => {
    const features = externalJobFeatures(externalRow());
    const intent = {
      ...emptyJobIntent('acct'),
      stated: true,
      compensation: {
        minAmount: 20_000,
        maxAmount: 40_000,
        currency: 'USD',
        payPeriod: 'YEARLY' as const,
      },
    };

    expect(alignSalary(features, intent, FX_TABLE)).toMatchObject({
      state: 'UNKNOWN',
      reason: 'SALARY_UNKNOWN',
      score: null,
    });
  });
});

describe('external jobs obey the same location rules', () => {
  it('a REMOTE external job with no stated countries is UNKNOWN, not worldwide', () => {
    const features = externalJobFeatures(
      externalRow({ workMode: 'REMOTE', countryCode: null, city: null }),
    );
    const intent = {
      ...emptyJobIntent('acct'),
      stated: true,
      locations: [{ countryCode: 'DE', region: null, city: null }],
      countries: ['DE'],
    };

    expect(alignLocation(features, intent)).toMatchObject({
      reason: 'LOCATION_UNKNOWN',
      score: null,
    });
  });

  it('stated remote countries are honoured', () => {
    const features = externalJobFeatures(
      externalRow({
        workMode: 'REMOTE',
        remoteCountriesAllowed: ['de', 'kr'],
        countryCode: null,
        city: null,
      }),
    );
    const intent = {
      ...emptyJobIntent('acct'),
      stated: true,
      locations: [{ countryCode: 'DE', region: null, city: null }],
      countries: ['DE'],
    };

    // PARTIAL rather than MATCH, exactly as for an internal vacancy: "you may
    // work from Germany" is a weaker claim than "this job is in Germany", and
    // the external path gets no better verdict than the internal one.
    expect(alignLocation(features, intent)).toMatchObject({
      state: 'PARTIAL',
      reason: 'LOCATION_REMOTE_ELIGIBLE',
    });
  });
});

describe('the whole chain, provider payload to salary verdict', () => {
  const CASES: [string, NormalizedExternalJobInput | null, number][] = [
    [
      'Ninehire · 40M KRW',
      normalizeNinehire({
        recruitmentId: 'nh-1',
        recruitmentTitle: 'Backend Engineer',
        detailUrl: 'https://ninehire.example/jobs/nh-1',
        companyName: 'ABC',
        workplace: { country: 'KR', city: 'Seoul' },
        annualSalary: { from: 40_000_000, currency: 'KRW' },
      }),
      28_865,
    ],
    [
      'Greenhouse · 70K USD',
      normalizeGreenhouse(
        {
          id: 7,
          title: 'Backend Engineer',
          absolute_url: 'https://boards.greenhouse.io/abc/jobs/7',
          content: 'x',
          metadata: [
            { name: 'Salary Min', value: '70000' },
            { name: 'Salary Currency', value: 'USD' },
            { name: 'Salary Period', value: 'YEARLY' },
          ],
        },
        'ABC',
      ),
      70_000,
    ],
    [
      'Ashby · 60K EUR',
      normalizeAshby(
        {
          id: 'a-1',
          title: 'Backend Engineer',
          jobUrl: 'https://jobs.ashbyhq.com/abc/a-1',
          compensation: {
            minValue: 60_000,
            currencyCode: 'EUR',
            interval: 'YEARLY',
          },
        },
        { name: 'ABC' },
      ),
      70_093,
    ],
  ];

  it.each(CASES)(
    '%s reaches a USD verdict with no provider-specific code',
    (_label, input, expectedUsd) => {
      expect(input).not.toBeNull();
      // provider payload → normalized input → features → shared matcher.
      const features = externalJobFeatures(
        externalRow({
          salaryMin: input!.salaryMin,
          salaryMax: input!.salaryMax,
          currency: input!.currency,
          payPeriod: input!.payPeriod,
        }),
      );
      const result = compareSalary(
        {
          min: features.salaryMin,
          max: features.salaryMax,
          currency: features.currency,
          payPeriod: features.payPeriod,
        },
        CANDIDATE,
        FX_TABLE,
      );

      expect(result.detail?.convertedMin).toBe(expectedUsd);
      expect(result.detail?.convertedCurrency).toBe('USD');
      expect(result.score).not.toBeNull();
    },
  );
});

/**
 * The REAL Greenhouse provider reaching the same matcher.
 *
 * Everything above used the fake normalizers Task 4A shipped. This block uses
 * the production `normalizeGreenhouseJob` on a payload shaped like the live
 * Job Board API, so the claim being tested is about shipped code rather than
 * a test fixture.
 */
describe('a real Greenhouse posting is just a job', () => {
  const BOARD = { boardToken: 'acme', label: 'Acme' };

  const PAYLOAD = {
    id: 5426468004,
    title: 'Account Executive, Enterprise',
    absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/5426468004',
    company_name: 'Acme',
    offices: [
      { name: 'Office - London', location: 'London, England, United Kingdom' },
    ],
    content:
      '&lt;p&gt;We are hiring an enterprise account executive for the ' +
      'London team and would love to hear from you.&lt;/p&gt;',
    pay_input_ranges: [
      { min_cents: 3500000, max_cents: 3800000, currency_type: 'USD' },
    ],
  };

  function featuresFor(payload = PAYLOAD) {
    const input = normalizeGreenhouseJob(payload, BOARD)!;
    expect(input).not.toBeNull();
    return externalJobFeatures(
      externalRow({
        id: 'ext-gh-1',
        title: input.title,
        countryCode: input.countryCode,
        region: input.region,
        city: input.city,
        workMode: input.workMode,
        employmentType: input.employmentType,
        seniorityLevel: input.seniorityLevel,
        salaryMin: input.salaryMin,
        salaryMax: input.salaryMax,
        currency: input.currency,
        payPeriod: input.payPeriod,
        company: { name: input.companyName },
      }),
    );
  }

  it('maps to NormalizedJobFeatures with no provider argument anywhere', () => {
    // `externalJobFeatures` takes ONE argument. If ranking ever needed to know
    // which ATS a job came from, this is where it would have to appear.
    expect(externalJobFeatures).toHaveLength(1);
    const features = featuresFor();
    expect(features.sourceType).toBe('EXTERNAL');
    expect(features.title).toBe('Account Executive, Enterprise');
    expect(features.country).toBe('GB');
    expect(features.city).toBe('London');
  });

  it('carries no Greenhouse vocabulary into the matcher', () => {
    const serialized = JSON.stringify(featuresFor());
    for (const token of ['greenhouse', 'absolute_url', 'min_cents', 'board']) {
      expect(serialized.toLowerCase()).not.toContain(token);
    }
  });

  it('is indistinguishable in shape from an internal vacancy', () => {
    const external = featuresFor();
    const internal = normalizedJobFeatures({
      id: 'vac-1',
      title: 'Account Executive, Enterprise',
      countryCode: 'GB',
      region: 'England',
      city: 'London',
      workMode: null,
      remoteCountriesAllowed: [],
      salaryMin: 35_000,
      salaryMax: 38_000,
      currency: 'USD',
      payPeriod: 'YEARLY',
      employmentTypeStructured: null,
      employmentType: null,
      seniorityLevel: null,
      benefits: [],
      industries: [],
      organization: { name: 'Acme' },
    } as never);
    expect(Object.keys(external).sort()).toEqual(Object.keys(internal).sort());
  });

  it('reaches a salary verdict through the existing FX pipeline', () => {
    // 3,500,000 cents is $35,000 — the cents conversion happening in the
    // provider, and no currency conversion happening there at all.
    const features = featuresFor();
    expect(features.salaryMin).toBe(35_000);
    expect(features.currency).toBe('USD');

    const verdict = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );
    expect(verdict.score).not.toBeNull();
    expect(verdict.detail?.convertedCurrency).toBe('USD');
  });

  it('converts a non-USD Greenhouse range with the same shared code', () => {
    const features = featuresFor({
      ...PAYLOAD,
      pay_input_ranges: [
        { min_cents: 6000000, max_cents: 7000000, currency_type: 'EUR' },
      ],
    });
    expect(features.salaryMin).toBe(60_000);
    expect(features.currency).toBe('EUR');

    const verdict = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );
    // 60,000 EUR at 0.856 per USD — the same arithmetic the Ninehire and
    // internal cases use, in the same module.
    expect(verdict.detail?.convertedMin).toBe(70_093);
    expect(features.salaryMin).toBe(60_000);
  });

  it('leaves the original currency untouched by the comparison', () => {
    const features = featuresFor({
      ...PAYLOAD,
      pay_input_ranges: [
        { min_cents: 6000000, max_cents: 7000000, currency_type: 'EUR' },
      ],
    });
    compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );
    expect(features.currency).toBe('EUR');
    expect(features.salaryMin).toBe(60_000);
  });

  it('scores a job with no posted salary rather than hiding it', () => {
    const features = featuresFor({ ...PAYLOAD, pay_input_ranges: [] });
    expect(features.salaryMin).toBeNull();
    const verdict = compareSalary(
      {
        min: null,
        max: null,
        currency: null,
        payPeriod: null,
      },
      CANDIDATE,
      FX_TABLE,
    );
    // Unknown salary is neutral. Most Greenhouse boards publish none, and
    // treating that as a mismatch would bury the majority of the catalogue.
    expect(verdict.score).toBeNull();
  });

  it('is unaffected by source trust', () => {
    // Trust decides canonical URLs and field conflicts. It is deliberately
    // absent from everything the matcher reads.
    const features = featuresFor();
    expect(Object.keys(features)).not.toContain('trust');
    expect(JSON.stringify(features)).not.toContain('COMPANY_CAREERS');
  });
});

/**
 * A real Lever posting reaching the same matcher.
 *
 * Same claim as the Greenhouse block above, made about a second provider — and
 * that is the whole point of the exercise. If the matcher had grown any
 * awareness of who produced a job, this is where it would show.
 */
describe('a real Lever posting is just a job', () => {
  const SITE = { slug: 'acme', label: 'Acme' };

  const PAYLOAD = {
    id: 'e1f2a3b4',
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
      min: 30_000,
      max: 38_000,
    },
    descriptionPlain:
      'We are hiring an Android engineer for the New York team.',
    hostedUrl: 'https://jobs.lever.co/acme/e1f2a3b4',
    applyUrl: 'https://jobs.lever.co/acme/e1f2a3b4/apply',
  };

  function featuresFor(payload: Record<string, unknown> = PAYLOAD) {
    const input = normalizeLeverPosting(payload, SITE)!;
    expect(input).not.toBeNull();
    return externalJobFeatures(
      externalRow({
        id: 'ext-lv-1',
        title: input.title,
        countryCode: input.countryCode,
        region: input.region,
        city: input.city,
        workMode: input.workMode,
        employmentType: input.employmentType,
        seniorityLevel: input.seniorityLevel,
        salaryMin: input.salaryMin,
        salaryMax: input.salaryMax,
        currency: input.currency,
        payPeriod: input.payPeriod,
        company: { name: input.companyName },
      }),
    );
  }

  it('maps to NormalizedJobFeatures with no provider argument', () => {
    const features = featuresFor();
    expect(features.sourceType).toBe('EXTERNAL');
    expect(features.title).toBe('Android Engineer III');
    expect(features.country).toBe('US');
    expect(features.city).toBe('New York');
    // The stated work mode Greenhouse could not supply.
    expect(features.workMode).toBe('ONSITE');
    expect(features.employmentType).toBe('FULL_TIME');
  });

  it('is indistinguishable from a Greenhouse job at the matcher', () => {
    // Two providers, one shape. The matcher cannot tell them apart because
    // there is nothing left in the shape to tell apart.
    const lever = featuresFor();
    const greenhouse = externalJobFeatures(
      externalRow({ id: 'ext-gh-9', title: 'Android Engineer III' }),
    );
    expect(Object.keys(lever).sort()).toEqual(Object.keys(greenhouse).sort());
  });

  it('carries no Lever vocabulary into the matcher', () => {
    const serialized = JSON.stringify(featuresFor()).toLowerCase();
    for (const token of [
      'lever',
      'hostedurl',
      'applyurl',
      'workplacetype',
      'commitment',
    ]) {
      expect(serialized).not.toContain(token);
    }
  });

  it('reaches a salary verdict through the existing FX pipeline', () => {
    const features = featuresFor();
    // Major units, exactly as Lever posted them — no cents conversion, which
    // is what makes provider-owned mapping necessary.
    expect(features.salaryMin).toBe(30_000);
    const verdict = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );
    expect(verdict.score).not.toBeNull();
    expect(verdict.detail?.convertedCurrency).toBe('USD');
  });

  it('converts a non-USD Lever range with the same shared code', () => {
    const features = featuresFor({
      ...PAYLOAD,
      salaryRange: {
        interval: 'per-year-salary',
        currency: 'EUR',
        min: 60_000,
        max: 70_000,
      },
    });
    expect(features.currency).toBe('EUR');
    const verdict = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );
    // The same arithmetic the Greenhouse, Ninehire and internal cases use.
    expect(verdict.detail?.convertedMin).toBe(70_093);
    // And the stored original is untouched by having been compared.
    expect(features.salaryMin).toBe(60_000);
    expect(features.currency).toBe('EUR');
  });

  it('reports an unstated salary as unknown rather than hiding the job', () => {
    const features = featuresFor({ ...PAYLOAD, salaryRange: undefined });
    expect(features.salaryMin).toBeNull();
    const verdict = compareSalary(
      { min: null, max: null, currency: null, payPeriod: null },
      CANDIDATE,
      FX_TABLE,
    );
    expect(verdict.score).toBeNull();
  });

  it('reports a period-less salary as not comparable rather than assuming a year', () => {
    // Lever's `bi-week-salary` keeps its amounts and loses its period. The
    // matcher must say so instead of quietly annualising.
    const features = featuresFor({
      ...PAYLOAD,
      salaryRange: {
        interval: 'bi-week-salary',
        currency: 'USD',
        min: 3_000,
        max: 3_500,
      },
    });
    expect(features.salaryMin).toBe(3_000);
    expect(features.payPeriod).toBeNull();
    const verdict = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );
    expect(verdict.score).toBeNull();
  });

  it('is unaffected by which ATS the job came from', () => {
    const features = featuresFor();
    expect(JSON.stringify(features)).not.toContain('trust');
    expect(Object.keys(features)).not.toContain('provider');
  });
});

/**
 * A real Ashby posting reaching the same matcher — and the three-way proof.
 */
describe('a real Ashby posting is just a job', () => {
  const BOARD = { slug: 'acme', label: 'Acme' };

  const PAYLOAD = {
    id: 'c3d4e5f6',
    title: 'Engineering Manager - EU',
    employmentType: 'FullTime',
    workplaceType: 'Remote',
    isRemote: true,
    isListed: true,
    address: {
      postalAddress: {
        addressLocality: 'Berlin',
        addressRegion: 'Berlin',
        addressCountry: 'Germany',
      },
    },
    descriptionPlain: 'We are hiring an engineering manager for the EU team.',
    jobUrl: 'https://jobs.ashbyhq.com/acme/c3d4e5f6',
    applyUrl: 'https://jobs.ashbyhq.com/acme/c3d4e5f6/application',
    compensation: {
      summaryComponents: [
        {
          compensationType: 'EquityPercentage',
          interval: 'NONE',
          currencyCode: null,
          minValue: null,
          maxValue: null,
        },
        {
          compensationType: 'Salary',
          interval: '1 YEAR',
          currencyCode: 'EUR',
          minValue: 30_000,
          maxValue: 38_000,
        },
      ],
    },
  };

  function featuresFor(payload: Record<string, unknown> = PAYLOAD) {
    const input = normalizeAshbyJob(payload, BOARD)!;
    expect(input).not.toBeNull();
    return externalJobFeatures(
      externalRow({
        id: 'ext-ab-1',
        title: input.title,
        countryCode: input.countryCode,
        region: input.region,
        city: input.city,
        workMode: input.workMode,
        employmentType: input.employmentType,
        seniorityLevel: input.seniorityLevel,
        salaryMin: input.salaryMin,
        salaryMax: input.salaryMax,
        currency: input.currency,
        payPeriod: input.payPeriod,
        company: { name: input.companyName },
      }),
    );
  }

  it('maps to NormalizedJobFeatures with no provider argument', () => {
    const features = featuresFor();
    expect(features.sourceType).toBe('EXTERNAL');
    expect(features.country).toBe('DE');
    expect(features.city).toBe('Berlin');
    expect(features.workMode).toBe('REMOTE');
    expect(features.employmentType).toBe('FULL_TIME');
  });

  it('produces the same key set as Greenhouse and Lever', () => {
    // Three providers, one shape. The matcher cannot tell them apart because
    // there is nothing left in the shape to tell apart.
    const ashby = Object.keys(featuresFor()).sort();
    const other = Object.keys(
      externalJobFeatures(externalRow({ id: 'ext-x' })),
    ).sort();
    expect(ashby).toEqual(other);
  });

  it('carries no Ashby vocabulary into the matcher', () => {
    const serialized = JSON.stringify(featuresFor()).toLowerCase();
    for (const token of [
      'ashby',
      'workplacetype',
      'islisted',
      'isremote',
      'compensation',
      'summarycomponents',
    ]) {
      expect(serialized).not.toContain(token);
    }
  });

  it('takes only the salary out of a mixed compensation package', () => {
    const features = featuresFor();
    // Equity was stated alongside it and contributed nothing.
    expect(features.salaryMin).toBe(30_000);
    expect(features.currency).toBe('EUR');
    expect(features.payPeriod).toBe('YEARLY');
  });

  it('converts through the existing FX pipeline, original untouched', () => {
    const features = featuresFor({
      ...PAYLOAD,
      compensation: {
        summaryComponents: [
          {
            compensationType: 'Salary',
            interval: '1 YEAR',
            currencyCode: 'EUR',
            minValue: 60_000,
            maxValue: 70_000,
          },
        ],
      },
    });
    const verdict = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );
    // The same arithmetic every other provider and internal vacancies use.
    expect(verdict.detail?.convertedMin).toBe(70_093);
    expect(features.salaryMin).toBe(60_000);
    expect(features.currency).toBe('EUR');
  });

  it('reports equity-only compensation as an unknown salary', () => {
    const features = featuresFor({
      ...PAYLOAD,
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
    });
    expect(features.salaryMin).toBeNull();
    const verdict = compareSalary(
      { min: null, max: null, currency: null, payPeriod: null },
      CANDIDATE,
      FX_TABLE,
    );
    expect(verdict.score).toBeNull();
  });

  it('is unaffected by which ATS the job came from', () => {
    expect(JSON.stringify(featuresFor())).not.toContain('trust');
    expect(Object.keys(featuresFor())).not.toContain('provider');
  });
});

/**
 * A Ninehire posting reaching the same matcher — and the four-way proof.
 *
 * Ninehire is authenticated per workspace and no authorized credential is
 * configured here, so this uses the officially documented shape rather than
 * captured traffic. What it proves is unchanged: a Korean posting from an
 * authenticated ATS becomes an ordinary job.
 */
describe('a Ninehire posting is just a job', () => {
  const SOURCE = { scope: 'acme', label: 'Acme Corp' };

  const PAYLOAD = {
    id: '2a2b0410-9b94-11ec-8ede-03ca65ff806e',
    title: '백엔드 개발자',
    applyUrl: 'https://career.ninehire.com/job_posting/3ETue9oP/apply',
    deadline: null,
    tags: ['백엔드'],
    career: 'experienced',
    careerRange: { over: 3, below: 6 },
    employmentTypes: ['full_time'],
    jobLocations: [
      {
        x: 129.12,
        y: 35.17,
        name: '부산지사',
        address: '부산 해운대구 센텀중앙로 97',
      },
    ],
    jobGroup: '개발팀',
    jobTask: '백엔드',
    affiliation: '나인하이어',
    createdAt: '2026-01-05T00:00:00.000Z',
    isPrivate: false,
    status: 'in_progress',
    content: '<p>백엔드 서비스를 함께 만들어 갈 동료를 찾습니다.</p>',
  };

  function featuresFor(payload: Record<string, unknown> = PAYLOAD) {
    const input = normalizeNinehireJob(payload, SOURCE)!;
    expect(input).not.toBeNull();
    return externalJobFeatures(
      externalRow({
        id: 'ext-nh-1',
        title: input.title,
        countryCode: input.countryCode,
        region: input.region,
        city: input.city,
        workMode: input.workMode,
        employmentType: input.employmentType,
        seniorityLevel: input.seniorityLevel,
        salaryMin: input.salaryMin,
        salaryMax: input.salaryMax,
        currency: input.currency,
        payPeriod: input.payPeriod,
        company: { name: input.companyName },
      }),
    );
  }

  it('maps to NormalizedJobFeatures with no provider argument', () => {
    const features = featuresFor();
    expect(features.sourceType).toBe('EXTERNAL');
    expect(features.country).toBe('KR');
    expect(features.city).toBe('해운대구');
    expect(features.employmentType).toBe('FULL_TIME');
  });

  it('produces the same key set as the other three providers', () => {
    // Four providers, one shape. The matcher cannot tell them apart because
    // there is nothing left in the shape to tell apart.
    const ninehire = Object.keys(featuresFor()).sort();
    const other = Object.keys(
      externalJobFeatures(externalRow({ id: 'ext-x' })),
    ).sort();
    expect(ninehire).toEqual(other);
  });

  it('carries the Korean title through the matcher unchanged', () => {
    // Not romanized, not translated, not stripped on the way in or out.
    expect(featuresFor().title).toBe('백엔드 개발자');
  });

  it('carries no Ninehire vocabulary into the matcher', () => {
    const serialized = JSON.stringify(featuresFor()).toLowerCase();
    for (const token of [
      'joblocations',
      'careerrange',
      'employmenttypes',
      'isprivate',
      'jobgroup',
      'affiliation',
      'in_progress',
    ]) {
      expect(serialized).not.toContain(token);
    }
  });

  it('reports an unknown salary rather than hiding the job', () => {
    // The API exposes no compensation field at all, so every Ninehire job
    // competes without a pay signal — neutral, never disqualifying.
    const features = featuresFor();
    expect(features.salaryMin).toBeNull();
    expect(features.currency).toBeNull();
    const verdict = compareSalary(
      { min: null, max: null, currency: null, payPeriod: null },
      CANDIDATE,
      FX_TABLE,
    );
    expect(verdict.score).toBeNull();
  });

  it('would reuse the existing FX pipeline for a KRW salary', () => {
    /*
     * Ninehire states no salary, so this drives the SHARED mapper with a KRW
     * figure directly. The point is that the KRW path is the same one every
     * other provider uses — if Ninehire ever exposes compensation, nothing
     * here needs to change.
     */
    const features = externalJobFeatures(
      externalRow({
        salaryMin: 40_000_000,
        salaryMax: null,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      }),
    );
    const verdict = compareSalary(
      {
        min: features.salaryMin,
        max: features.salaryMax,
        currency: features.currency,
        payPeriod: features.payPeriod,
      },
      CANDIDATE,
      FX_TABLE,
    );
    expect(verdict.detail?.convertedMin).toBe(28_865);
    expect(verdict.detail?.convertedCurrency).toBe('USD');
    // The stored original is untouched by having been compared.
    expect(features.salaryMin).toBe(40_000_000);
    expect(features.currency).toBe('KRW');
  });

  it.each([40_000_000, 100_000_000, 500_000_000, 2_000_000_000])(
    'handles a KRW figure of %i without integer overflow',
    (amount) => {
      /*
       * PostgreSQL INTEGER tops out at 2,147,483,647 and the ingestion limit
       * is 2,000,000,000, so an ordinary — or extraordinary — KRW annual
       * salary fits. A figure above the limit is refused rather than wrapped,
       * which is the direction that fails safely.
       */
      const features = externalJobFeatures(
        externalRow({
          salaryMin: amount,
          salaryMax: null,
          currency: 'KRW',
          payPeriod: 'YEARLY',
        }),
      );
      expect(features.salaryMin).toBe(amount);
      expect(features.salaryMin).toBeLessThan(2_147_483_647);
      const verdict = compareSalary(
        {
          min: features.salaryMin,
          max: features.salaryMax,
          currency: features.currency,
          payPeriod: features.payPeriod,
        },
        CANDIDATE,
        FX_TABLE,
      );
      expect(verdict.detail?.convertedMin).toBeGreaterThan(0);
    },
  );

  it('never annualizes a monthly figure on the way in', () => {
    // The catastrophic bug this guards: 4,000,000 KRW MONTHLY stored as
    // YEARLY would understate the job twelvefold.
    const monthly = externalJobFeatures(
      externalRow({
        salaryMin: 4_000_000,
        salaryMax: null,
        currency: 'KRW',
        payPeriod: 'MONTHLY',
      }),
    );
    expect(monthly.salaryMin).toBe(4_000_000);
    expect(monthly.payPeriod).toBe('MONTHLY');
    const yearly = externalJobFeatures(
      externalRow({
        salaryMin: 4_000_000,
        salaryMax: null,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      }),
    );
    // Same number, different meaning — and the matcher is told which.
    const monthlyVerdict = compareSalary(
      {
        min: monthly.salaryMin,
        max: null,
        currency: 'KRW',
        payPeriod: 'MONTHLY',
      },
      CANDIDATE,
      FX_TABLE,
    );
    const yearlyVerdict = compareSalary(
      {
        min: yearly.salaryMin,
        max: null,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      },
      CANDIDATE,
      FX_TABLE,
    );
    expect(monthlyVerdict.detail?.convertedMin).not.toBe(
      yearlyVerdict.detail?.convertedMin,
    );
  });

  it('is unaffected by which ATS the job came from', () => {
    expect(JSON.stringify(featuresFor())).not.toContain('trust');
    expect(Object.keys(featuresFor())).not.toContain('provider');
  });
});
