import {
  alignBenefits,
  alignEmployment,
  alignIndustries,
  alignIntent,
  alignLocation,
  alignRole,
  alignSalary,
  alignSeniority,
  alignWorkMode,
} from './intent-alignment';
import { emptyJobIntent } from '../candidate-preferences/candidate-job-intent';
import type { CandidateJobIntent } from '../candidate-preferences/candidate-job-intent';
import type { NormalizedJobFeatures } from './normalized-job-features';

/**
 * Intent alignment: soft signals with honest unknowns.
 *
 * Two properties dominate: a mismatch on any dimension is a low score, NEVER
 * a removal (removal lives in hard-constraints and is tested there), and a
 * dimension the employer did not state is `score: null` — out of the average
 * entirely, neither punished nor rewarded.
 */

function job(
  overrides: Partial<NormalizedJobFeatures> = {},
): NormalizedJobFeatures {
  return {
    jobId: 'vac-1',
    sourceType: 'INTERNAL',
    title: 'Backend Engineer',
    organizationName: 'Acme',
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
    industries: [],
    ...overrides,
  };
}

function intent(
  overrides: Partial<CandidateJobIntent> = {},
): CandidateJobIntent {
  return { ...emptyJobIntent('acct-1'), stated: true, ...overrides };
}

describe('alignRole', () => {
  it('exact normalized title is the top of the ladder', () => {
    const result = alignRole(job({ title: 'Backend  Engineer' }), [
      'backend engineer',
    ]);
    expect(result).toMatchObject({
      state: 'MATCH',
      reason: 'ROLE_EXACT',
      score: 1,
    });
  });

  it('a title containing every preferred token aligns strongly', () => {
    // "Backend Engineer" ⊂ "Backend API Engineer": same job, longer name.
    const result = alignRole(job({ title: 'Backend API Engineer' }), [
      'Backend Engineer',
    ]);
    expect(result).toMatchObject({ state: 'PARTIAL', reason: 'ROLE_RELATED' });
    expect(result.score).toBeGreaterThan(0.7);
  });

  it('same role family scores above a stranger, below a near-name', () => {
    const family = alignRole(job({ title: 'Node.js Developer' }), [
      'Backend Engineer',
    ]);
    expect(family).toMatchObject({
      state: 'PARTIAL',
      reason: 'ROLE_FAMILY_MATCH',
    });
    const related = alignRole(job({ title: 'Backend API Engineer' }), [
      'Backend Engineer',
    ]);
    expect(related.score!).toBeGreaterThan(family.score!);
  });

  it('an unrelated title is a MISMATCH — low, and only low', () => {
    // The score is 0; existence is not this module's business at all.
    const result = alignRole(job({ title: 'Product Designer' }), [
      'Backend Engineer',
    ]);
    expect(result).toMatchObject({
      state: 'MISMATCH',
      reason: 'ROLE_MISMATCH',
      score: 0,
    });
  });

  it('the BEST preferred title wins, not the first', () => {
    const result = alignRole(job({ title: 'Backend Engineer' }), [
      'Product Designer',
      'Backend Engineer',
    ]);
    expect(result.reason).toBe('ROLE_EXACT');
  });
});

describe('alignLocation', () => {
  const seoulIntent = intent({
    locations: [{ countryCode: 'KR', region: null, city: 'Seoul' }],
    countries: ['KR'],
  });

  it('exact city is the strongest', () => {
    const result = alignLocation(
      job({ country: 'KR', city: 'Seoul' }),
      seoulIntent,
    );
    expect(result).toMatchObject({
      state: 'MATCH',
      reason: 'LOCATION_EXACT',
      score: 1,
    });
  });

  it('same country, different city is weaker than the exact city', () => {
    const busan = alignLocation(
      job({ country: 'KR', city: 'Busan' }),
      seoulIntent,
    );
    expect(busan).toMatchObject({
      state: 'PARTIAL',
      reason: 'LOCATION_COUNTRY_MATCH',
    });
    expect(busan.score!).toBeLessThan(1);
  });

  it('same region sits between city and country', () => {
    const ontario = intent({
      locations: [{ countryCode: 'CA', region: 'Ontario', city: 'Toronto' }],
      countries: ['CA'],
    });
    const sameRegion = alignLocation(
      job({ country: 'CA', region: 'ontario', city: 'Ottawa' }),
      ontario,
    );
    expect(sameRegion).toMatchObject({ reason: 'LOCATION_REGION_MATCH' });
    const sameCountry = alignLocation(
      job({ country: 'CA', region: 'British Columbia', city: 'Vancouver' }),
      ontario,
    );
    expect(sameRegion.score!).toBeGreaterThan(sameCountry.score!);
  });

  it('a known other country is a MISMATCH — soft, still scored, never removed', () => {
    const result = alignLocation(
      job({ country: 'DE', city: 'Berlin' }),
      seoulIntent,
    );
    expect(result).toMatchObject({
      state: 'MISMATCH',
      reason: 'LOCATION_MISMATCH',
      score: 0,
    });
  });

  it('willingness to relocate softens a known mismatch, never fakes a match', () => {
    const relocating = intent({
      locations: [{ countryCode: 'KR', region: null, city: 'Seoul' }],
      countries: ['KR'],
      relocation: true,
    });
    const result = alignLocation(job({ country: 'DE' }), relocating);
    expect(result.state).toBe('MISMATCH');
    expect(result.score).toBe(0.3);
  });

  it('relocation NULL means "did not say" and changes nothing', () => {
    const result = alignLocation(job({ country: 'DE' }), seoulIntent);
    expect(result.score).toBe(0);
  });

  it('REMOTE with the preferred country in its allowed list is a strong match', () => {
    const result = alignLocation(
      job({ workMode: 'REMOTE', remoteCountriesAllowed: ['KR', 'JP'] }),
      seoulIntent,
    );
    expect(result).toMatchObject({ reason: 'LOCATION_REMOTE_ELIGIBLE' });
    expect(result.score!).toBeGreaterThanOrEqual(0.85);
  });

  it('REMOTE with UNKNOWN geography is UNKNOWN — remote never means worldwide', () => {
    const result = alignLocation(
      job({ workMode: 'REMOTE', remoteCountriesAllowed: [] }),
      seoulIntent,
    );
    expect(result).toMatchObject({
      state: 'UNKNOWN',
      reason: 'LOCATION_UNKNOWN',
      score: null,
    });
  });

  it('a vacancy with no structured location is UNKNOWN, not punished', () => {
    // 209 pre-migration vacancies have exactly this shape.
    const result = alignLocation(job(), seoulIntent);
    expect(result).toMatchObject({ state: 'UNKNOWN', score: null });
  });
});

describe('alignWorkMode', () => {
  const remoteIntent = intent({ workModes: ['REMOTE', 'HYBRID'] });

  it('a preferred mode matches', () => {
    expect(
      alignWorkMode(job({ workMode: 'HYBRID' }), remoteIntent),
    ).toMatchObject({ state: 'MATCH', reason: 'WORK_MODE_MATCH', score: 1 });
  });

  it('a stated other mode is a soft mismatch', () => {
    expect(
      alignWorkMode(job({ workMode: 'ONSITE' }), remoteIntent),
    ).toMatchObject({ state: 'MISMATCH', score: 0 });
  });

  it('an unstated mode is UNKNOWN', () => {
    expect(alignWorkMode(job(), remoteIntent)).toMatchObject({
      state: 'UNKNOWN',
      score: null,
    });
  });
});

describe('alignSalary', () => {
  const cadIntent = intent({
    compensation: {
      minAmount: 70_000,
      maxAmount: null,
      currency: 'CAD',
      payPeriod: 'YEARLY',
    },
  });

  it('a range at or above the floor MEETS', () => {
    const result = alignSalary(
      job({
        salaryMin: 80_000,
        salaryMax: 100_000,
        currency: 'CAD',
        payPeriod: 'YEARLY',
      }),
      cadIntent,
    );
    expect(result).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_MEETS_MINIMUM',
      score: 1,
    });
  });

  it('a range straddling the floor can pay it — partial credit', () => {
    const result = alignSalary(
      job({
        salaryMin: 60_000,
        salaryMax: 80_000,
        currency: 'CAD',
        payPeriod: 'YEARLY',
      }),
      cadIntent,
    );
    expect(result).toMatchObject({ state: 'PARTIAL', score: 0.75 });
  });

  it('a range below the floor lowers the score and does nothing else', () => {
    const result = alignSalary(
      job({
        salaryMin: 60_000,
        salaryMax: 65_000,
        currency: 'CAD',
        payPeriod: 'YEARLY',
      }),
      cadIntent,
    );
    expect(result).toMatchObject({
      state: 'MISMATCH',
      reason: 'SALARY_BELOW_MINIMUM',
      score: 0,
    });
  });

  it('an unstated salary is UNKNOWN — unstated is not zero', () => {
    expect(alignSalary(job(), cadIntent)).toMatchObject({
      state: 'UNKNOWN',
      reason: 'SALARY_UNKNOWN',
      score: null,
    });
  });

  it('a different currency WITH a usable rate table converts and compares', () => {
    // The reason FX exists: a Korean salary measured against a Canadian
    // expectation, in the candidate's own currency.
    const table = { baseCurrency: 'USD', rates: { CAD: 1.35, KRW: 1350 } };
    const result = alignSalary(
      job({
        salaryMin: 90_000_000,
        salaryMax: 110_000_000,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      }),
      cadIntent,
      table,
    );
    // 90M KRW = 90,000 CAD, above the 70,000 floor.
    expect(result).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_MEETS_MINIMUM',
    });
    expect(result.salary?.originalCurrency).toBe('KRW');
    expect(result.salary?.originalMin).toBe(90_000_000);
    expect(result.salary?.convertedCurrency).toBe('CAD');
    expect(result.salary?.convertedMin).toBe(90_000);
  });

  it('a different currency with NO rate table is NOT_COMPARABLE, never compared raw', () => {
    // 55,000,000 KRW is not "more than" 70,000 CAD; without FX there is no
    // honest comparison, and a wrong one would mis-rank in both directions.
    const result = alignSalary(
      job({
        salaryMin: 55_000_000,
        salaryMax: 65_000_000,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      }),
      cadIntent,
    );
    expect(result).toMatchObject({
      state: 'NOT_COMPARABLE',
      reason: 'SALARY_NOT_COMPARABLE',
      score: null,
    });
  });

  it('MONTHLY is brought onto the YEARLY scale — that one IS a definition', () => {
    // 6,000 CAD/month is 72,000 CAD/year, above the 70,000 floor. Twelve
    // months in a year is a fact, unlike hours per week.
    const result = alignSalary(
      job({ salaryMin: 6_000, currency: 'CAD', payPeriod: 'MONTHLY' }),
      cadIntent,
    );
    expect(result).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_MEETS_MINIMUM',
    });
    expect(result.salary?.convertedMin).toBe(72_000);
  });

  it('HOURLY against a YEARLY expectation stays NOT_COMPARABLE', () => {
    // Hours per week and weeks per year vary by country, contract and
    // employer; 40 x 52 would be our invention, not the employer's offer.
    const result = alignSalary(
      job({ salaryMin: 60, currency: 'CAD', payPeriod: 'HOURLY' }),
      cadIntent,
    );
    expect(result).toMatchObject({
      state: 'NOT_COMPARABLE',
      reason: 'SALARY_NOT_COMPARABLE',
      score: null,
    });
  });
});

describe('alignEmployment', () => {
  const ftIntent = intent({ employmentTypes: ['FULL_TIME'] });

  it('bridges the legacy free text through the ONE normalizer', () => {
    // The features layer already ran normalizeEmploymentType; here the
    // canonical value matches the preference.
    expect(
      alignEmployment(job({ employmentType: 'FULL_TIME' }), ftIntent),
    ).toMatchObject({ state: 'MATCH', score: 1 });
  });

  it('a stated other type is a soft mismatch', () => {
    expect(
      alignEmployment(job({ employmentType: 'CONTRACT' }), ftIntent),
    ).toMatchObject({ state: 'MISMATCH', score: 0 });
  });

  it('an unrecognized or unstated type is UNKNOWN, never defaulted', () => {
    expect(alignEmployment(job(), ftIntent)).toMatchObject({
      state: 'UNKNOWN',
      score: null,
    });
  });
});

describe('alignSeniority', () => {
  const midSenior = intent({ seniorityLevels: ['MID', 'SENIOR'] });

  it('a preferred level matches', () => {
    expect(
      alignSeniority(job({ seniorityLevel: 'SENIOR' }), midSenior),
    ).toMatchObject({ state: 'MATCH', score: 1 });
  });

  it('one step away counts for half', () => {
    expect(
      alignSeniority(job({ seniorityLevel: 'JUNIOR' }), midSenior),
    ).toMatchObject({
      state: 'PARTIAL',
      reason: 'SENIORITY_ADJACENT',
      score: 0.5,
    });
  });

  it('a distant level is a soft mismatch, and the job stays visible', () => {
    expect(
      alignSeniority(job({ seniorityLevel: 'INTERN' }), midSenior),
    ).toMatchObject({ state: 'MISMATCH', score: 0 });
  });

  it('unstated level is UNKNOWN', () => {
    expect(alignSeniority(job(), midSenior)).toMatchObject({
      state: 'UNKNOWN',
      score: null,
    });
  });
});

describe('alignIndustries and alignBenefits', () => {
  it('industry overlap is exact-normalized only — two folksonomies get no fuzz', () => {
    const fintech = intent({ preferredIndustries: ['Fintech'] });
    expect(
      alignIndustries(job({ industries: ['fintech', 'payments'] }), fintech),
    ).toMatchObject({ state: 'MATCH', score: 1 });
    expect(
      alignIndustries(job({ industries: ['finance'] }), fintech),
    ).toMatchObject({ state: 'MISMATCH', score: 0 });
    expect(alignIndustries(job(), fintech)).toMatchObject({
      state: 'UNKNOWN',
      score: null,
    });
  });

  it('benefits score by the fraction of wanted ones offered; silence is UNKNOWN', () => {
    const wants = intent({
      preferredBenefits: ['HEALTH_INSURANCE', 'STOCK_OPTIONS'],
    });
    expect(
      alignBenefits(
        job({ benefits: ['HEALTH_INSURANCE', 'STOCK_OPTIONS'] }),
        wants,
      ),
    ).toMatchObject({ state: 'MATCH', score: 1 });
    expect(
      alignBenefits(job({ benefits: ['HEALTH_INSURANCE', 'BONUS'] }), wants),
    ).toMatchObject({ state: 'PARTIAL', score: 0.5 });
    expect(alignBenefits(job({ benefits: ['BONUS'] }), wants)).toMatchObject({
      state: 'MISMATCH',
      score: 0,
    });
    expect(alignBenefits(job(), wants)).toMatchObject({
      state: 'UNKNOWN',
      score: null,
    });
  });
});

describe('alignIntent', () => {
  it('produces NO entry for a dimension the candidate did not state', () => {
    // An empty preference list can never penalize or reward: the dimension
    // simply does not exist in the result.
    const result = alignIntent(
      job({ workMode: 'ONSITE', seniorityLevel: 'JUNIOR' }),
      intent({ roles: ['Backend Engineer'] }),
    );
    expect(result.map((a) => a.dimension)).toEqual(['role']);
  });

  it('a candidate with no preferences aligns as [] — the no-op case', () => {
    expect(alignIntent(job(), emptyJobIntent('acct-1'))).toEqual([]);
  });

  it('covers every stated dimension exactly once', () => {
    const full = intent({
      roles: ['Backend Engineer'],
      locations: [{ countryCode: 'KR', region: null, city: null }],
      countries: ['KR'],
      workModes: ['REMOTE'],
      compensation: {
        minAmount: 1,
        maxAmount: null,
        currency: 'USD',
        payPeriod: 'YEARLY',
      },
      employmentTypes: ['FULL_TIME'],
      seniorityLevels: ['SENIOR'],
      preferredIndustries: ['fintech'],
      preferredBenefits: ['BONUS'],
    });
    const dims = alignIntent(job(), full).map((a) => a.dimension);
    expect(dims.sort()).toEqual(
      [
        'benefits',
        'employmentType',
        'industries',
        'location',
        'role',
        'salary',
        'seniority',
        'workMode',
      ].sort(),
    );
  });
});
