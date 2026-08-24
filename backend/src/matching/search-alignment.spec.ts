import {
  compareSearchResults,
  hasSecondaryPreferences,
  searchAlignment,
  searchScoreFrom,
  type SearchSecondaryFilters,
} from './search-alignment';
import type { NormalizedJobFeatures } from './normalized-job-features';
import type { IntentAlignment } from './intent-alignment';

const NO_FILTERS: SearchSecondaryFilters = {
  workModes: [],
  employmentTypes: [],
  seniorityLevels: [],
  compensation: null,
  preferredLocations: [],
};

function job(over: Partial<NormalizedJobFeatures> = {}): NormalizedJobFeatures {
  return {
    jobId: 'v1',
    sourceType: 'INTERNAL' as const,
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
    ...over,
  };
}

const alignment = (
  dimension: IntentAlignment['dimension'],
  score: number | null,
): IntentAlignment => ({ dimension, state: 'MATCH', reason: 'X', score });

describe('what counts as a soft preference at all', () => {
  it('an empty search states nothing', () => {
    expect(hasSecondaryPreferences(NO_FILTERS)).toBe(false);
  });

  it('any single dimension is enough to rank by', () => {
    expect(
      hasSecondaryPreferences({ ...NO_FILTERS, workModes: ['REMOTE'] }),
    ).toBe(true);
    expect(
      hasSecondaryPreferences({
        ...NO_FILTERS,
        preferredLocations: [{ countryCode: 'KR', region: null, city: null }],
      }),
    ).toBe(true);
  });

  it('nothing stated scores null rather than zero', () => {
    // Null leaves the catalogue's own order alone. Zero would claim every job
    // is a bad answer to a question nobody asked.
    expect(searchAlignment(job(), NO_FILTERS).score).toBeNull();
  });
});

describe('the three tiers', () => {
  const asked: SearchSecondaryFilters = {
    ...NO_FILTERS,
    workModes: ['REMOTE'],
  };

  it('a job that matches leads', () => {
    expect(searchAlignment(job({ workMode: 'REMOTE' }), asked).score).toBe(100);
  });

  it('a job nobody described sits in the middle', () => {
    expect(searchAlignment(job({ workMode: null }), asked).score).toBe(50);
  });

  it('a job that contradicts the search ranks last', () => {
    expect(searchAlignment(job({ workMode: 'ONSITE' }), asked).score).toBe(0);
  });

  it('silence and mismatch are NOT the same position', () => {
    // The product tells the candidate these are different things; the order
    // has to agree, or "we do not know" reads as "no".
    const unknown = searchAlignment(job({ workMode: null }), asked).score!;
    const mismatch = searchAlignment(job({ workMode: 'ONSITE' }), asked).score!;
    expect(unknown).toBeGreaterThan(mismatch);
  });
});

describe('the score covers what was ASKED, not what could be measured', () => {
  const everything: SearchSecondaryFilters = {
    ...NO_FILTERS,
    workModes: ['REMOTE'],
    employmentTypes: ['FULL_TIME'],
    seniorityLevels: ['SENIOR'],
  };

  it('answering everything beats answering one thing and staying silent', () => {
    const complete = searchAlignment(
      job({
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        seniorityLevel: 'SENIOR',
      }),
      everything,
    ).score!;
    const mostlySilent = searchAlignment(
      job({ employmentType: 'FULL_TIME' }),
      everything,
    ).score!;

    expect(complete).toBe(100);
    expect(mostlySilent).toBeLessThan(complete);
  });

  it('an unanswered dimension keeps its weight in the denominator', () => {
    // workMode 14 + employmentType 8: a perfect employment match with an
    // unknown work mode earns 8 + 7 of 22.
    expect(
      searchScoreFrom([
        alignment('workMode', null),
        alignment('employmentType', 1),
      ]),
    ).toBe(Math.round(((14 * 0.5 + 8) / 22) * 100));
  });

  it('scores null only when nothing was asked', () => {
    expect(searchScoreFrom([])).toBeNull();
  });
});

describe('cross-currency pay is the shared comparison, not a second one', () => {
  const table = { baseCurrency: 'USD', rates: { USD: 1, KRW: 1385.7418 } };
  const wantsUsd: SearchSecondaryFilters = {
    ...NO_FILTERS,
    compensation: {
      minAmount: 20_000,
      maxAmount: null,
      currency: 'USD',
      payPeriod: 'YEARLY',
    },
  };

  it('a KRW posting answers a USD floor', () => {
    const result = searchAlignment(
      job({
        salaryMin: 40_000_000,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      }),
      wantsUsd,
      table,
    );

    expect(result.score).toBe(100);
    expect(result.alignments[0].reason).toBe('SALARY_MEETS_MINIMUM');
  });

  it('an FX outage is neutral, never a mismatch', () => {
    const result = searchAlignment(
      job({ salaryMin: 40_000_000, currency: 'KRW', payPeriod: 'YEARLY' }),
      wantsUsd,
      null,
    );

    expect(result.alignments[0].state).toBe('NOT_COMPARABLE');
    expect(result.score).toBe(50);
  });

  it('pay below the floor is measured, and still scored', () => {
    const result = searchAlignment(
      job({ salaryMin: 5_000, currency: 'USD', payPeriod: 'YEARLY' }),
      wantsUsd,
      table,
    );

    expect(result.alignments[0].reason).toBe('SALARY_BELOW_MINIMUM');
    expect(result.score).toBe(0);
  });
});

describe('the order is total and stable', () => {
  const at = (ms: number) => new Date(ms);

  it('alignment decides first', () => {
    expect(
      compareSearchResults(
        { score: 40, createdAt: at(1), publicSlug: 'a' },
        { score: 90, createdAt: at(2), publicSlug: 'b' },
      ),
    ).toBeGreaterThan(0);
  });

  it('equal alignment falls back to recency, then slug', () => {
    expect(
      compareSearchResults(
        { score: 50, createdAt: at(2), publicSlug: 'b' },
        { score: 50, createdAt: at(1), publicSlug: 'a' },
      ),
    ).toBeLessThan(0);
    expect(
      compareSearchResults(
        { score: 50, createdAt: at(1), publicSlug: 'a' },
        { score: 50, createdAt: at(1), publicSlug: 'b' },
      ),
    ).toBeLessThan(0);
  });

  it('two identical entries compare equal, so a sort cannot shuffle them', () => {
    const entry = { score: 50, createdAt: at(1), publicSlug: 'a' };
    expect(compareSearchResults(entry, { ...entry })).toBe(0);
  });

  it('an unranked entry sorts below a measured zero', () => {
    // Only ever reached when some jobs were comparable and others were not;
    // it decides order alone and removes nothing.
    expect(
      compareSearchResults(
        { score: null, createdAt: at(9), publicSlug: 'a' },
        { score: 0, createdAt: at(1), publicSlug: 'b' },
      ),
    ).toBeGreaterThan(0);
  });
});
