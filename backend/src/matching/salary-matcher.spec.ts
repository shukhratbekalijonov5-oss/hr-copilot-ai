import { compareSalary, type DesiredSalary } from './salary-matcher';
import type { RateTable } from '../fx/money';

/**
 * Salary alignment: the product rule, end to end, without a database.
 *
 * Every test here builds plain objects. That is the point of the module — the
 * same comparison serves an internal vacancy and an external posting, and if
 * any of this needed a Prisma row the external pipeline would have to
 * reimplement it.
 */

const TABLE: RateTable = {
  baseCurrency: 'USD',
  rates: { KRW: 1390, AUD: 1.52, CAD: 1.36, EUR: 0.92 },
};

/** 20,000–40,000 USD a year: the worked example from the brief. */
const RANGE: DesiredSalary = {
  min: 20_000,
  max: 40_000,
  currency: 'USD',
  payPeriod: 'YEARLY',
};

/** A floor with no upper end — what most people state. */
const FLOOR: DesiredSalary = {
  min: 20_000,
  max: null,
  currency: 'USD',
  payPeriod: 'YEARLY',
};

const usd = (min: number | null, max: number | null = null) => ({
  min,
  max,
  currency: 'USD',
  payPeriod: 'YEARLY' as const,
});

describe('a candidate who stated a range', () => {
  it('a salary inside the range is a full match', () => {
    expect(compareSalary(usd(28_000), RANGE, TABLE)).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_WITHIN_DESIRED_RANGE',
      score: 1,
    });
  });

  it('a band that overlaps the range from below is partial', () => {
    expect(compareSalary(usd(15_000, 25_000), RANGE, TABLE)).toMatchObject({
      state: 'PARTIAL',
      reason: 'SALARY_PARTIAL_OVERLAP',
      score: 0.75,
    });
  });

  it('a band entirely below the minimum scores zero — and only that', () => {
    // Still returned, still ranked, still on a page. People take pay cuts for
    // the right role and the product does not decide that for them.
    expect(compareSalary(usd(10_000, 15_000), RANGE, TABLE)).toMatchObject({
      state: 'MISMATCH',
      reason: 'SALARY_BELOW_MINIMUM',
      score: 0,
    });
  });

  it('a salary ABOVE the range is a match, not a penalty', () => {
    // Their maximum is the top of what they hoped for, not a limit on what
    // they will accept. Marking 50-60K down against a 20-40K wish would be
    // the system deciding something about their money that they never said.
    expect(compareSalary(usd(50_000, 60_000), RANGE, TABLE)).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_ABOVE_DESIRED_RANGE',
      score: 1,
    });
  });

  it('a band spanning the whole range is partial, not perfect', () => {
    expect(compareSalary(usd(5_000, 90_000), RANGE, TABLE)).toMatchObject({
      state: 'PARTIAL',
      reason: 'SALARY_PARTIAL_OVERLAP',
    });
  });

  it('exact boundaries count as inside', () => {
    expect(compareSalary(usd(20_000, 40_000), RANGE, TABLE)).toMatchObject({
      reason: 'SALARY_WITHIN_DESIRED_RANGE',
    });
  });
});

describe('a candidate who stated only a floor', () => {
  it('uses floor semantics and never invents range language', () => {
    expect(compareSalary(usd(28_000), FLOOR, TABLE)).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_MEETS_MINIMUM',
      score: 1,
    });
    // No SALARY_WITHIN_DESIRED_RANGE / ABOVE_DESIRED_RANGE without a max.
    expect(compareSalary(usd(90_000), FLOOR, TABLE).reason).toBe(
      'SALARY_MEETS_MINIMUM',
    );
  });

  it('a band straddling the floor is partial', () => {
    expect(compareSalary(usd(15_000, 25_000), FLOOR, TABLE)).toMatchObject({
      state: 'PARTIAL',
      reason: 'SALARY_PARTIAL_OVERLAP',
    });
  });

  it('below the floor is a soft mismatch', () => {
    expect(compareSalary(usd(9_000, 12_000), FLOOR, TABLE)).toMatchObject({
      state: 'MISMATCH',
      reason: 'SALARY_BELOW_MINIMUM',
    });
  });
});

describe('cross-currency — the reason FX exists', () => {
  it('40,000,000 KRW against a 20K–40K USD range', () => {
    const result = compareSalary(
      {
        min: 40_000_000,
        max: 40_000_000,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      },
      RANGE,
      TABLE,
    );
    // ≈ 28,777 USD, inside 20,000–40,000.
    expect(result).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_WITHIN_DESIRED_RANGE',
    });
    expect(result.detail).toMatchObject({
      originalMin: 40_000_000,
      originalCurrency: 'KRW',
      convertedMin: 28_777,
      convertedCurrency: 'USD',
      convertedPayPeriod: 'YEARLY',
    });
  });

  it('90,000–110,000 AUD against the same USD range', () => {
    const result = compareSalary(
      { min: 90_000, max: 110_000, currency: 'AUD', payPeriod: 'YEARLY' },
      RANGE,
      TABLE,
    );
    // ≈ 59,211–72,368 USD: above what they asked for, so a match.
    expect(result).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_ABOVE_DESIRED_RANGE',
    });
    expect(result.detail.convertedMin).toBe(59_211);
    expect(result.detail.convertedMax).toBe(72_368);
  });

  it('the ORIGINAL amounts always survive the comparison', () => {
    // The employer said KRW. Nothing in the pipeline may overwrite that with
    // a converted figure.
    const result = compareSalary(
      { min: 40_000_000, max: null, currency: 'KRW', payPeriod: 'YEARLY' },
      RANGE,
      TABLE,
    );
    expect(result.detail.originalMin).toBe(40_000_000);
    expect(result.detail.originalCurrency).toBe('KRW');
    expect(result.detail.originalPayPeriod).toBe('YEARLY');
  });
});

describe('what cannot be compared', () => {
  it('an unstated salary is UNKNOWN and scores nothing', () => {
    const result = compareSalary(
      { min: null, max: null, currency: null, payPeriod: null },
      RANGE,
      TABLE,
    );
    expect(result).toMatchObject({
      state: 'UNKNOWN',
      reason: 'SALARY_UNKNOWN',
      score: null,
    });
  });

  it("FX unavailable is NOT_COMPARABLE — our outage, not the employer's silence", () => {
    const result = compareSalary(
      { min: 40_000_000, max: null, currency: 'KRW', payPeriod: 'YEARLY' },
      RANGE,
      null,
    );
    expect(result).toMatchObject({
      state: 'NOT_COMPARABLE',
      reason: 'SALARY_NOT_COMPARABLE',
      score: null,
    });
    // And the two are DIFFERENT reasons, so the UI can say different things.
    expect(result.reason).not.toBe('SALARY_UNKNOWN');
  });

  it('same-currency pay still compares perfectly during an FX outage', () => {
    expect(compareSalary(usd(28_000), RANGE, null)).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_WITHIN_DESIRED_RANGE',
    });
  });

  it('an hourly posting against a yearly expectation is NOT_COMPARABLE', () => {
    expect(
      compareSalary(
        { min: 60, max: null, currency: 'USD', payPeriod: 'HOURLY' },
        RANGE,
        TABLE,
      ),
    ).toMatchObject({ state: 'NOT_COMPARABLE' });
  });

  it('every unusable outcome scores null, never zero', () => {
    // null keeps the dimension out of the intent average entirely; zero would
    // quietly punish a job for a fact nobody established.
    for (const offered of [
      { min: null, max: null, currency: null, payPeriod: null },
      {
        min: 40_000_000,
        max: null,
        currency: 'KRW' as const,
        payPeriod: 'YEARLY' as const,
      },
    ]) {
      expect(compareSalary(offered, RANGE, null).score).toBeNull();
    }
  });
});

describe('external-job readiness', () => {
  it('matches a normalized EXTERNAL job object with no Prisma row anywhere', () => {
    /*
     * This is the shape a Greenhouse / Lever / Ashby / Ninehire adapter will
     * produce. It is a plain object: no vacancy id, no organization, no
     * database row, nothing internal. If this test ever needs one of those,
     * the external pipeline would have to reimplement salary matching — which
     * is exactly what this module exists to prevent.
     */
    const externalJob = {
      salaryMin: 40_000_000,
      salaryMax: 40_000_000,
      currency: 'KRW',
      payPeriod: 'YEARLY' as const,
    };

    const result = compareSalary(
      {
        min: externalJob.salaryMin,
        max: externalJob.salaryMax,
        currency: externalJob.currency,
        payPeriod: externalJob.payPeriod,
      },
      RANGE,
      TABLE,
    );

    expect(result).toMatchObject({
      state: 'MATCH',
      reason: 'SALARY_WITHIN_DESIRED_RANGE',
      score: 1,
    });
    expect(result.detail.convertedCurrency).toBe('USD');
    expect(result.detail.convertedMin).toBe(28_777);
  });

  it('the same code path serves four currencies without per-provider logic', () => {
    const postings = [
      { currency: 'KRW', min: 40_000_000, max: 40_000_000 },
      { currency: 'AUD', min: 45_000, max: 55_000 },
      { currency: 'CAD', min: 40_000, max: 48_000 },
      { currency: 'EUR', min: 25_000, max: 32_000 },
    ];
    for (const posting of postings) {
      const result = compareSalary(
        {
          min: posting.min,
          max: posting.max,
          currency: posting.currency,
          payPeriod: 'YEARLY',
        },
        RANGE,
        TABLE,
      );
      expect(result.score).not.toBeNull();
      expect(result.detail.convertedCurrency).toBe('USD');
      expect(result.detail.originalCurrency).toBe(posting.currency);
    }
  });
});
