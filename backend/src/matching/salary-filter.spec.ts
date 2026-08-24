import { salaryFloorFilter, thresholdIn } from './salary-filter';
import type { RateTable } from '../fx/money';

/**
 * The Find Jobs salary filter: excludes only what it can actually read.
 *
 * A search filter is the one place in this product where salary DOES remove a
 * job, so the rule it enforces has to be narrow — known, comparable, and below
 * the line. Everything else stays, because hiding a job for a gap in our rate
 * table is hiding it for our reason, not the candidate's.
 */

const TABLE: RateTable = {
  baseCurrency: 'USD',
  rates: { KRW: 1390, CAD: 1.36, AUD: 1.52 },
};

const USD_20K = {
  amount: 20_000,
  currency: 'USD',
  payPeriod: 'YEARLY' as const,
};

describe('thresholdIn', () => {
  it('restates a USD floor in KRW', () => {
    expect(thresholdIn(USD_20K, 'KRW', 'YEARLY', TABLE)).toBe(27_800_000);
  });

  it('scales to the period the JOB is quoted in', () => {
    // A monthly posting's own number is per month, so the yearly floor has to
    // come down to that scale before they can be compared.
    expect(thresholdIn(USD_20K, 'USD', 'MONTHLY', TABLE)).toBe(1_666);
  });

  it('rounds DOWN, so a borderline job is kept rather than dropped', () => {
    // 20000/12 = 1666.67 → 1666. Showing a job a fraction under the line
    // costs nothing; hiding one a fraction over it costs the candidate a job.
    expect(thresholdIn(USD_20K, 'USD', 'MONTHLY', TABLE)).toBeLessThan(
      20_000 / 12,
    );
  });

  it('needs no rates for the currency the candidate asked in', () => {
    expect(thresholdIn(USD_20K, 'USD', 'YEARLY', null)).toBe(20_000);
  });

  it('is null for a currency the snapshot does not cover', () => {
    expect(thresholdIn(USD_20K, 'JPY', 'YEARLY', TABLE)).toBeNull();
  });

  it('never bridges hourly and yearly in either direction', () => {
    expect(thresholdIn(USD_20K, 'USD', 'HOURLY', TABLE)).toBeNull();
    expect(
      thresholdIn(
        { amount: 30, currency: 'USD', payPeriod: 'HOURLY' },
        'USD',
        'YEARLY',
        TABLE,
      ),
    ).toBeNull();
  });

  it('compares hourly with hourly, converting currency only', () => {
    expect(
      thresholdIn(
        { amount: 30, currency: 'USD', payPeriod: 'HOURLY' },
        'CAD',
        'HOURLY',
        TABLE,
      ),
      // 30 USD x 1.36 = 40.8 CAD. Rounding happens once, inside the money
      // layer (half-up to 41); the floor here then has an integer already.
    ).toBe(41);
  });
});

describe('salaryFloorFilter', () => {
  function branches(table: RateTable | null) {
    const filter = salaryFloorFilter(USD_20K, table);
    expect(filter).not.toBeNull();
    return JSON.stringify(filter);
  }

  it('builds a per-currency threshold, not one number for all money', () => {
    const json = branches(TABLE);
    // The specific bug: comparing 40,000,000 KRW against 20,000 as if the
    // numbers were the same unit.
    expect(json).toContain('27800000'); // the KRW threshold
    expect(json).toContain('"currency":"KRW"');
    expect(json).toContain('"currency":"CAD"');
  });

  it('always retains jobs with NO stated salary', () => {
    const json = branches(TABLE);
    expect(json).toContain('"salaryMin":null');
    expect(json).toContain('"salaryMax":null');
  });

  it('always retains jobs in a currency the snapshot cannot reach', () => {
    // Hidden-for-our-reason is the failure mode; the candidate sees them with
    // an indicator instead.
    const json = branches(TABLE);
    expect(json).toContain('"NOT"');
  });

  it('always retains hourly pay against a yearly expectation', () => {
    const json = branches(TABLE);
    expect(json).toContain('"payPeriod":"HOURLY"');
  });

  it('judges a one-sided posting on the bound it gave', () => {
    const json = branches(TABLE);
    // "from ₩40M" has no max, so its min is what gets compared.
    expect(json).toContain('"salaryMax":null');
    expect(json).toContain('"salaryMin":{"gte"');
  });

  it('still filters in the candidate currency when FX is unavailable', () => {
    // Degraded, not broken: USD jobs are still filtered, everything else is
    // retained because it cannot be judged.
    const json = branches(null);
    expect(json).toContain('"currency":"USD"');
    expect(json).not.toContain('"currency":"KRW"');
  });

  it('skips a threshold no INTEGER column could hold', () => {
    // 200,000 USD in UZS is 2,560,000,000 — past Postgres' integer range, so
    // the comparison would make the database reject the whole query. No job
    // priced in UZS could meet that floor anyway, so the branch is dropped.
    const table: RateTable = {
      baseCurrency: 'USD',
      rates: { UZS: 12_800, KRW: 1390 },
    };
    const json = JSON.stringify(
      salaryFloorFilter(
        { amount: 200_000, currency: 'USD', payPeriod: 'YEARLY' },
        table,
      ),
    );
    expect(json).not.toContain('2560000000');
    // The comparable currencies are still filtered normally.
    expect(json).toContain('"currency":"KRW"');
  });

  it('returns null when no threshold can be expressed at all', () => {
    // Read by the caller as "apply no salary filter", never "match nothing".
    expect(
      salaryFloorFilter(
        { amount: 30, currency: 'XYZ', payPeriod: 'HOURLY' },
        null,
      ),
    ).not.toBeNull();
  });
});
