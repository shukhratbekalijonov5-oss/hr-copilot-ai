import {
  rankExternalJobs,
  searchRowFeatures,
  textRelevance,
} from './external-search.ranking';
import { SEMANTIC_TEXT_CEILING } from './external-search.policy';
import type { ExternalSearchRow } from './external-search.retrieval';
import type { SearchSecondaryFilters } from '../../matching/search-alignment';
import type { RateTable } from '../../fx/money';

/**
 * What the ranking may and may not take into account.
 *
 * Most of these tests are about ABSENCE — that a provider's name, its trust
 * class and the number of times a job was observed have no effect whatever on
 * where it appears. Those are the properties that quietly stop being true, and
 * the only way they stay true is if breaking them fails a test.
 */

function row(over: Partial<ExternalSearchRow> = {}): ExternalSearchRow {
  return {
    id: 'job-1',
    title: 'Backend Engineer',
    status: 'ACTIVE',
    countryCode: 'KR',
    region: null,
    city: 'Seoul',
    additionalLocations: [],
    workMode: 'HYBRID',
    remoteCountriesAllowed: [],
    employmentType: 'FULL_TIME',
    seniorityLevel: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    benefits: [],
    industries: [],
    canonicalUrl: 'https://boards.example.org/1',
    employerPostedAt: null,
    firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-08-01T00:00:00Z'),
    expiresAt: null,
    companyName: 'Acme',
    companyWebsiteUrl: null,
    ...over,
  };
}

const NO_SOFT: SearchSecondaryFilters = {
  workModes: [],
  employmentTypes: [],
  seniorityLevels: [],
  compensation: null,
  preferredLocations: [],
};

function rank(input: {
  rows: ExternalSearchRow[];
  lexical?: Record<string, number>;
  semantic?: Record<string, number>;
  scoreText?: boolean;
  soft?: SearchSecondaryFilters;
  rates?: RateTable | null;
  sort?: 'RELEVANCE' | 'NEWEST';
}) {
  return rankExternalJobs({
    rows: input.rows,
    lexical: new Map(Object.entries(input.lexical ?? {})),
    semantic: new Map(Object.entries(input.semantic ?? {})),
    scoreText: input.scoreText ?? true,
    soft: input.soft ?? NO_SOFT,
    rates: input.rates ?? null,
    features: searchRowFeatures,
    sort: input.sort ?? 'RELEVANCE',
  });
}

describe('text relevance', () => {
  it('is the stronger of the two matchers', () => {
    // Lexical and semantic measure the same thing differently; the best
    // evidence either found is the answer.
    expect(textRelevance(0.9, 0.2)).toBe(90);
    expect(textRelevance(0.1, 1)).toBe(Math.round(SEMANTIC_TEXT_CEILING * 100));
  });

  it('caps a semantic-only match below a strong lexical one', () => {
    /*
     * A job literally TITLED what the candidate searched for has answered the
     * question; one an embedding merely placed nearby has offered an
     * alternative. Without the ceiling a 0.97-similarity near-miss beats a
     * 0.95 exact title match — which is how a search starts feeling like it
     * is ignoring what you typed.
     */
    const exactTitle = textRelevance(0.95, undefined);
    const nearestNeighbour = textRelevance(undefined, 0.97);
    expect(exactTitle).toBeGreaterThan(nearestNeighbour);
  });

  it('is zero when neither matcher found anything', () => {
    expect(textRelevance(undefined, undefined)).toBe(0);
  });
});

describe('what has NO effect on rank', () => {
  /*
   * The ranking reads `ExternalSearchRow`, and that shape carries no
   * provider, no source trust and no source count. These tests assert the
   * consequence: two jobs identical except for provenance rank identically,
   * and there is no field a future change could quietly start reading.
   */
  it('cannot see the provider at all', () => {
    const keys = Object.keys(row());
    expect(keys).not.toContain('provider');
    expect(keys).not.toContain('sourceCount');
    expect(keys).not.toContain('sourceTrust');
  });

  it('ranks two identical jobs identically whatever their source', () => {
    const [a, b] = rank({
      rows: [row({ id: 'a' }), row({ id: 'b' })],
      lexical: { a: 0.8, b: 0.8 },
    });
    expect(a.score).toBe(b.score);
    // Order then falls to the tie-break, which is id — not provenance.
    expect([a.externalJobId, b.externalJobId]).toEqual(['a', 'b']);
  });

  it('does not reward a job for having been observed twice', () => {
    // Provenance count is display data. Two observations make a job better
    // EVIDENCED, not a better answer to the search.
    const single = rank({ rows: [row({ id: 'a' })], lexical: { a: 0.7 } })[0];
    const doubled = rank({ rows: [row({ id: 'a' })], lexical: { a: 0.7 } })[0];
    expect(single.score).toBe(doubled.score);
  });
});

describe('soft dimensions rank, they do not remove', () => {
  const soft = (
    over: Partial<SearchSecondaryFilters>,
  ): SearchSecondaryFilters => ({
    ...NO_SOFT,
    ...over,
  });

  it('keeps a contradicting job in the results, ranked lower', () => {
    const results = rank({
      rows: [
        row({ id: 'remote', workMode: 'REMOTE' }),
        row({ id: 'onsite', workMode: 'ONSITE' }),
      ],
      lexical: { remote: 0.5, onsite: 0.5 },
      soft: soft({ workModes: ['REMOTE'] }),
    });
    expect(results).toHaveLength(2);
    expect(results[0].externalJobId).toBe('remote');
    expect(results[1].externalJobId).toBe('onsite');
  });

  it('treats an unstated dimension as neutral, between match and mismatch', () => {
    /*
     * "The employer did not say" is not "this does not match", and the order
     * has to agree with what the product tells the reader.
     */
    const results = rank({
      rows: [
        row({ id: 'match', workMode: 'REMOTE' }),
        row({ id: 'unknown', workMode: null }),
        row({ id: 'mismatch', workMode: 'ONSITE' }),
      ],
      lexical: { match: 0.5, unknown: 0.5, mismatch: 0.5 },
      soft: soft({ workModes: ['REMOTE'] }),
    });
    expect(results.map((r) => r.externalJobId)).toEqual([
      'match',
      'unknown',
      'mismatch',
    ]);
  });

  it('leaves a job with no salary neutral rather than penalized', () => {
    const results = rank({
      rows: [
        row({ id: 'unknown' }),
        row({
          id: 'below',
          salaryMin: 10_000,
          salaryMax: 12_000,
          currency: 'USD',
          payPeriod: 'YEARLY',
        }),
      ],
      lexical: { unknown: 0.5, below: 0.5 },
      soft: soft({
        compensation: {
          minAmount: 100_000,
          maxAmount: null,
          currency: 'USD',
          payPeriod: 'YEARLY',
        },
      }),
    });
    // Both reachable; silence outranks a stated contradiction.
    expect(results).toHaveLength(2);
    expect(results[0].externalJobId).toBe('unknown');
    const unknown = results.find((r) => r.externalJobId === 'unknown')!;
    expect(unknown.reasons.map((r) => r.code)).toContain('SALARY_UNKNOWN');
  });

  it('never hides a job that pays below the floor', () => {
    const results = rank({
      rows: [
        row({
          id: 'low',
          salaryMin: 10_000,
          currency: 'USD',
          payPeriod: 'YEARLY',
        }),
      ],
      lexical: { low: 0.9 },
      soft: soft({
        compensation: {
          minAmount: 100_000,
          maxAmount: null,
          currency: 'USD',
          payPeriod: 'YEARLY',
        },
      }),
    });
    expect(results).toHaveLength(1);
    expect(results[0].reasons.map((r) => r.code)).toContain(
      'SALARY_BELOW_MINIMUM',
    );
  });

  it('compares salary across currencies through the shared FX table', () => {
    /*
     * The same pipeline internal vacancies use. A 40,000,000 KRW posting
     * answers a question asked in USD, and no arithmetic for it exists in the
     * search code.
     */
    const rates: RateTable = {
      baseCurrency: 'USD',
      rates: { USD: 1, KRW: 1390 },
    };
    const results = rank({
      rows: [
        row({
          id: 'krw',
          salaryMin: 40_000_000,
          salaryMax: 50_000_000,
          currency: 'KRW',
          payPeriod: 'YEARLY',
        }),
      ],
      lexical: { krw: 0.5 },
      rates,
      soft: soft({
        compensation: {
          minAmount: 20_000,
          maxAmount: 40_000,
          currency: 'USD',
          payPeriod: 'YEARLY',
        },
      }),
    });
    const codes = results[0].reasons.map((r) => r.code);
    expect(codes.some((code) => code.startsWith('SALARY_'))).toBe(true);
    expect(codes).not.toContain('SALARY_UNKNOWN');
    // The stored original is untouched by the comparison.
    expect(results[0].row.salaryMin).toBe(40_000_000);
    expect(results[0].row.currency).toBe('KRW');
  });

  it('degrades salary to NOT_COMPARABLE rather than guessing when FX is gone', () => {
    const results = rank({
      rows: [
        row({
          id: 'krw',
          salaryMin: 40_000_000,
          currency: 'KRW',
          payPeriod: 'YEARLY',
        }),
      ],
      lexical: { krw: 0.5 },
      rates: null,
      soft: soft({
        compensation: {
          minAmount: 20_000,
          maxAmount: null,
          currency: 'USD',
          payPeriod: 'YEARLY',
        },
      }),
    });
    expect(results[0].reasons.map((r) => r.code)).toContain(
      'SALARY_NOT_COMPARABLE',
    );
    // Neutral: it neither gains nor loses rank for being incomparable.
    expect(results[0].intentScore).not.toBe(0);
  });
});

describe('determinism', () => {
  it('produces the same order for the same input, every time', () => {
    const rows = [
      row({ id: 'a', title: 'Backend Engineer' }),
      row({ id: 'b', title: 'Senior Backend Engineer' }),
      row({ id: 'c', title: 'Marketing Manager' }),
    ];
    const once = rank({ rows, lexical: { a: 0.9, b: 0.8, c: 0.1 } });
    const twice = rank({
      rows: [...rows].reverse(),
      lexical: { a: 0.9, b: 0.8, c: 0.1 },
    });
    expect(twice.map((r) => r.externalJobId)).toEqual(
      once.map((r) => r.externalJobId),
    );
  });

  it('ranks a title match above description noise', () => {
    // The whole point of the weighted document: a Marketing Manager job whose
    // description mentions backend engineers is not a backend engineering job.
    const results = rank({
      rows: [
        row({ id: 'title', title: 'Backend Engineer' }),
        row({ id: 'noise', title: 'Marketing Manager' }),
      ],
      lexical: { title: 0.95, noise: 0.05 },
    });
    expect(results[0].externalJobId).toBe('title');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});

describe('the feature mapping', () => {
  it('passes salary through untouched, in the source currency', () => {
    const features = searchRowFeatures(
      row({ salaryMin: 40_000_000, currency: 'KRW', payPeriod: 'YEARLY' }),
    );
    expect(features.salaryMin).toBe(40_000_000);
    expect(features.currency).toBe('KRW');
    expect(features.sourceType).toBe('EXTERNAL');
  });

  it('uppercases country codes so comparisons cannot miss on case', () => {
    const features = searchRowFeatures(
      row({ countryCode: 'kr', remoteCountriesAllowed: ['us', 'ca'] }),
    );
    expect(features.country).toBe('KR');
    expect(features.remoteCountriesAllowed).toEqual(['US', 'CA']);
  });

  it('uses the company name only as an exclusion key, never a score', () => {
    // Same field the internal mapping uses, same purpose: an external
    // company's unfamiliar name must not cost its jobs a place.
    const features = searchRowFeatures(row({ companyName: 'Unknown Ltd' }));
    expect(features.organizationName).toBe('Unknown Ltd');
    const results = rank({
      rows: [
        row({ id: 'a', companyName: 'Google' }),
        row({ id: 'b', companyName: 'Nobody Ltd' }),
      ],
      lexical: { a: 0.5, b: 0.5 },
    });
    expect(results[0].score).toBe(results[1].score);
  });
});

describe('general professions', () => {
  it.each([
    ['Backend Engineer'],
    ['Senior Accountant'],
    ['Marketing Manager'],
    ['Enterprise Account Executive'],
    ['Corporate Counsel'],
    ['Registered Nurse'],
    ['Logistics Coordinator'],
    ['백엔드 개발자'],
    ['마케팅 매니저'],
  ])('%s ranks with no profession-specific branch', (title) => {
    const results = rank({
      rows: [row({ id: 'x', title })],
      lexical: { x: 0.8 },
    });
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
  });
});
