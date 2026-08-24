import {
  evaluateHardConstraints,
  partitionByHardConstraints,
} from './hard-constraints';
import { emptyJobIntent } from '../candidate-preferences/candidate-job-intent';
import type { CandidateJobIntent } from '../candidate-preferences/candidate-job-intent';
import type { NormalizedJobFeatures } from './normalized-job-features';

/**
 * Hard constraints: the ONLY removals, and only on the candidate's explicit
 * word. Everything else in these tests must come back ELIGIBLE — including
 * every saved positive preference, every mismatch, and every unknown.
 */

function job(
  overrides: Partial<NormalizedJobFeatures> = {},
): NormalizedJobFeatures {
  return {
    jobId: 'vac-1',
    sourceType: 'INTERNAL',
    title: 'Backend Engineer',
    organizationName: 'Acme Corp',
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

const ELIGIBLE = { eligibility: 'ELIGIBLE', reason: null };

describe('explicit exclusions — the only hard removals', () => {
  it('an exactly-matching excluded company removes the job', () => {
    const result = evaluateHardConstraints(
      job({ organizationName: 'ABC Corp' }),
      intent({
        exclusions: { companies: ['abc  corp'], jobTitles: [], locations: [] },
      }),
    );
    expect(result).toEqual({
      eligibility: 'HARD_EXCLUDED',
      reason: 'EXCLUDED_COMPANY',
    });
  });

  it('a similar-but-not-same company does NOT over-exclude', () => {
    // "ABC Corp" excluded must not silently hide "ABC Corporation": the
    // candidate never asked to lose those jobs, and there is no UI where
    // they would find out.
    const result = evaluateHardConstraints(
      job({ organizationName: 'ABC Corporation' }),
      intent({
        exclusions: { companies: ['ABC Corp'], jobTitles: [], locations: [] },
      }),
    );
    expect(result).toEqual(ELIGIBLE);
  });

  it('an exactly-matching excluded title removes, conservatively', () => {
    const exclusions = {
      companies: [],
      jobTitles: ['Backend Engineer'],
      locations: [],
    };
    expect(
      evaluateHardConstraints(
        job({ title: 'Backend  engineer' }),
        intent({ exclusions }),
      ),
    ).toMatchObject({ eligibility: 'HARD_EXCLUDED', reason: 'EXCLUDED_TITLE' });
    // "Senior Backend Engineer" is a DIFFERENT title. Not removed.
    expect(
      evaluateHardConstraints(
        job({ title: 'Senior Backend Engineer' }),
        intent({ exclusions }),
      ),
    ).toEqual(ELIGIBLE);
  });

  it('an excluded structured location removes only a confident exact fit', () => {
    const exclusions = {
      companies: [],
      jobTitles: [],
      locations: [{ countryCode: 'KR', region: null, city: 'Seoul' }],
    };
    expect(
      evaluateHardConstraints(
        job({ country: 'KR', city: 'Seoul' }),
        intent({ exclusions }),
      ),
    ).toMatchObject({ reason: 'EXCLUDED_LOCATION' });
    // Same country, different city: not what was excluded.
    expect(
      evaluateHardConstraints(
        job({ country: 'KR', city: 'Busan' }),
        intent({ exclusions }),
      ),
    ).toEqual(ELIGIBLE);
    // Country known, city UNKNOWN: maybe Seoul, maybe not — "maybe" never
    // excludes.
    expect(
      evaluateHardConstraints(job({ country: 'KR' }), intent({ exclusions })),
    ).toEqual(ELIGIBLE);
  });

  it('a whole-country exclusion removes any vacancy confidently in it', () => {
    const exclusions = {
      companies: [],
      jobTitles: [],
      locations: [{ countryCode: 'KR', region: null, city: null }],
    };
    expect(
      evaluateHardConstraints(
        job({ country: 'KR', city: 'Busan' }),
        intent({ exclusions }),
      ),
    ).toMatchObject({ reason: 'EXCLUDED_LOCATION' });
  });

  it('UNKNOWN location can never trigger an exclusion', () => {
    const result = evaluateHardConstraints(
      job(), // no structured location at all
      intent({
        exclusions: {
          companies: [],
          jobTitles: [],
          locations: [{ countryCode: 'KR', region: null, city: null }],
        },
      }),
    );
    expect(result).toEqual(ELIGIBLE);
  });
});

describe('what must NOT remove', () => {
  it('saved positive location preference never hard-filters', () => {
    // Candidate prefers Seoul; the job is in Berlin. It ranks lower; it stays.
    const result = evaluateHardConstraints(
      job({ country: 'DE', city: 'Berlin' }),
      intent({
        locations: [{ countryCode: 'KR', region: null, city: 'Seoul' }],
        countries: ['KR'],
      }),
    );
    expect(result).toEqual(ELIGIBLE);
  });

  it('saved work mode, salary floor, seniority and role never hard-filter', () => {
    const demanding = intent({
      roles: ['Backend Engineer'],
      workModes: ['REMOTE'],
      compensation: {
        minAmount: 90_000,
        maxAmount: null,
        currency: 'USD',
        payPeriod: 'YEARLY',
      },
      seniorityLevels: ['SENIOR'],
      employmentTypes: ['FULL_TIME'],
    });
    // A vacancy contradicting every single stated preference:
    const opposite = job({
      title: 'Product Designer',
      workMode: 'ONSITE',
      salaryMin: 30_000,
      salaryMax: 35_000,
      currency: 'USD',
      payPeriod: 'YEARLY',
      seniorityLevel: 'INTERN',
      employmentType: 'INTERNSHIP',
    });
    expect(evaluateHardConstraints(opposite, demanding)).toEqual(ELIGIBLE);
  });

  it('an empty intent hard-filters nothing', () => {
    expect(evaluateHardConstraints(job(), emptyJobIntent('acct-1'))).toEqual(
      ELIGIBLE,
    );
  });
});

describe('request-level strict filters', () => {
  it('an explicit strict country filter removes a known mismatch — for that request only', () => {
    const result = evaluateHardConstraints(
      job({ country: 'KR' }),
      emptyJobIntent('acct-1'),
      { strictCountries: ['DE'] },
    );
    expect(result).toMatchObject({
      eligibility: 'HARD_EXCLUDED',
      reason: 'REQUEST_COUNTRY_FILTER',
    });
  });

  it('a REMOTE job workable from the requested country survives a strict filter', () => {
    const result = evaluateHardConstraints(
      job({
        country: 'KR',
        workMode: 'REMOTE',
        remoteCountriesAllowed: ['DE'],
      }),
      emptyJobIntent('acct-1'),
      { strictCountries: ['DE'] },
    );
    expect(result).toEqual(ELIGIBLE);
  });

  it('the strict filter is a REQUEST input — saved countries are never fed through it', () => {
    // The function only filters what it is explicitly handed. A saved KR
    // preference arrives as intent, not as strictCountries, and removes
    // nothing — asserted by the saved-preference test above; here: no
    // options means no request filter, whatever the intent says.
    const result = evaluateHardConstraints(
      job({ country: 'DE' }),
      intent({
        locations: [{ countryCode: 'KR', region: null, city: null }],
        countries: ['KR'],
      }),
      {},
    );
    expect(result).toEqual(ELIGIBLE);
  });
});

describe('partitionByHardConstraints', () => {
  it('splits the universe and accounts for every job exactly once', () => {
    const universe = [
      job({ jobId: 'v1', organizationName: 'ABC Corp' }),
      job({ jobId: 'v2' }),
      job({ jobId: 'v3', country: 'KR', city: 'Seoul' }),
    ];
    const result = partitionByHardConstraints(
      universe,
      intent({
        exclusions: {
          companies: ['ABC Corp'],
          jobTitles: [],
          locations: [{ countryCode: 'KR', region: null, city: 'Seoul' }],
        },
      }),
    );
    expect(result.eligible.map((f) => f.jobId)).toEqual(['v2']);
    // The exclusion record still names `vacancyId`: it is stored in the run's
    // `excluded` JSON, and renaming a persisted field would orphan every row
    // written before today.
    expect(result.excluded).toEqual([
      { vacancyId: 'v1', reason: 'EXCLUDED_COMPANY' },
      { vacancyId: 'v3', reason: 'EXCLUDED_LOCATION' },
    ]);
  });
});
