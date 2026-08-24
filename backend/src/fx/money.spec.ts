import {
  convert,
  normalizeSalary,
  periodsComparable,
  rateBetween,
  toYearly,
  type RateTable,
} from './money';

/**
 * Money: exact, deterministic, and honest about what it cannot compare.
 *
 * The two properties that matter most here are that a 50,000,000 KRW salary
 * survives conversion without drifting, and that an unknown rate produces
 * null rather than a plausible-looking wrong number.
 */

/** A realistic USD-based table. Values are illustrative, not live rates. */
const TABLE: RateTable = {
  baseCurrency: 'USD',
  rates: { KRW: 1390, EUR: 0.92, CAD: 1.36, AUD: 1.52, GBP: 0.79, JPY: 157 },
};

describe('convert', () => {
  it('KRW → USD: the case the whole feature exists for', () => {
    // 40,000,000 KRW at 1390/USD ≈ 28,777 USD.
    expect(convert(40_000_000, 'KRW', 'USD', TABLE)).toBe(28_777);
  });

  it('AUD → USD', () => {
    expect(convert(90_000, 'AUD', 'USD', TABLE)).toBe(59_211);
  });

  it('CAD → USD', () => {
    expect(convert(70_000, 'CAD', 'USD', TABLE)).toBe(51_471);
  });

  it('EUR → USD', () => {
    expect(convert(50_000, 'EUR', 'USD', TABLE)).toBe(54_348);
  });

  it('USD → KRW, the other direction', () => {
    expect(convert(28_777, 'USD', 'KRW', TABLE)).toBe(40_000_030);
  });

  it('cross-rate through the base neither side is', () => {
    // 100,000 CAD → EUR = 100000 * (0.92 / 1.36).
    expect(convert(100_000, 'CAD', 'EUR', TABLE)).toBe(67_647);
  });

  it('same currency needs no table at all', () => {
    // Load-bearing: same-currency comparison must keep working during an FX
    // outage, so it never consults the rates.
    expect(
      convert(55_000_000, 'KRW', 'KRW', { baseCurrency: 'USD', rates: {} }),
    ).toBe(55_000_000);
  });

  it('the base currency is implicitly 1.0 even when the table omits it', () => {
    expect(convert(100, 'USD', 'CAD', TABLE)).toBe(136);
  });

  it('an unknown currency is null — never silently treated as 1:1', () => {
    // The specific bug this prevents: 40,000,000 KRW compared against a USD
    // range as though the numbers were the same unit.
    expect(convert(40_000_000, 'XYZ', 'USD', TABLE)).toBeNull();
    expect(convert(40_000_000, 'KRW', 'XYZ', TABLE)).toBeNull();
  });

  it('a corrupt rate (zero, negative, NaN) is null, not a wild number', () => {
    const broken: RateTable = {
      baseCurrency: 'USD',
      rates: { AAA: 0, BBB: -3, CCC: Number.NaN },
    };
    expect(convert(100, 'AAA', 'USD', broken)).toBeNull();
    expect(convert(100, 'BBB', 'USD', broken)).toBeNull();
    expect(convert(100, 'CCC', 'USD', broken)).toBeNull();
  });

  it('holds precision on large KRW amounts', () => {
    // Float arithmetic is where a salary quietly becomes 54,999,999.999994.
    const usd = convert(55_000_000, 'KRW', 'USD', TABLE);
    expect(usd).toBe(39_568);
    expect(Number.isInteger(usd)).toBe(true);
  });

  it('rounds half-up, deterministically', () => {
    const half: RateTable = { baseCurrency: 'USD', rates: { HAL: 2 } };
    // 5 / 2 = 2.5 → 3, every time, on every machine.
    expect(convert(5, 'HAL', 'USD', half)).toBe(3);
    expect(convert(5, 'HAL', 'USD', half)).toBe(3);
  });

  it('is stable: the same inputs always give the same output', () => {
    const runs = new Set(
      Array.from({ length: 50 }, () =>
        convert(123_456_789, 'KRW', 'EUR', TABLE),
      ),
    );
    expect(runs.size).toBe(1);
  });

  it('is case-insensitive about currency codes', () => {
    expect(convert(1000, 'krw', 'usd', TABLE)).toBe(
      convert(1000, 'KRW', 'USD', TABLE),
    );
  });
});

describe('rateBetween', () => {
  it('reports the effective rate for diagnostics', () => {
    expect(rateBetween('USD', 'CAD', TABLE)).toBeCloseTo(1.36, 6);
    expect(rateBetween('XYZ', 'USD', TABLE)).toBeNull();
  });
});

describe('pay periods', () => {
  it('MONTHLY → YEARLY is a definition, and exact', () => {
    expect(toYearly(3_000_000, 'MONTHLY')).toBe(36_000_000);
  });

  it('YEARLY stays YEARLY', () => {
    expect(toYearly(40_000_000, 'YEARLY')).toBe(40_000_000);
  });

  it('HOURLY refuses to become YEARLY', () => {
    // 40 hours a week and 52 weeks a year are OUR assumptions, not the
    // employer's statement. Inventing them would fabricate a salary.
    expect(toYearly(60, 'HOURLY')).toBeNull();
  });

  it('comparability follows: monthly/yearly yes, hourly only with hourly', () => {
    expect(periodsComparable('MONTHLY', 'YEARLY')).toBe(true);
    expect(periodsComparable('YEARLY', 'MONTHLY')).toBe(true);
    expect(periodsComparable('HOURLY', 'YEARLY')).toBe(false);
    expect(periodsComparable('HOURLY', 'HOURLY')).toBe(true);
  });
});

describe('normalizeSalary', () => {
  const yearlyUsd = (salary: Parameters<typeof normalizeSalary>[0]) =>
    normalizeSalary(salary, 'USD', 'YEARLY', TABLE);

  it('converts a KRW band into the candidate currency', () => {
    const result = yearlyUsd({
      min: 40_000_000,
      max: 55_000_000,
      currency: 'KRW',
      payPeriod: 'YEARLY',
    });
    expect(result).toEqual({
      ok: true,
      salary: {
        min: 28_777,
        max: 39_568,
        currency: 'USD',
        payPeriod: 'YEARLY',
        converted: true,
      },
    });
  });

  it('brings a MONTHLY posting onto the yearly scale before converting', () => {
    const result = yearlyUsd({
      min: 4_000_000,
      max: null,
      currency: 'KRW',
      payPeriod: 'MONTHLY',
    });
    // 4M KRW/month → 48M KRW/year → USD.
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.salary.min).toBe(34_532);
  });

  it('a salary already in the target currency needs no rates', () => {
    const result = normalizeSalary(
      { min: 90_000, max: 110_000, currency: 'USD', payPeriod: 'YEARLY' },
      'USD',
      'YEARLY',
      null,
    );
    expect(result).toMatchObject({
      ok: true,
      salary: { min: 90_000, max: 110_000, converted: false },
    });
  });

  it('an unstated salary is UNSTATED, not zero', () => {
    expect(
      yearlyUsd({ min: null, max: null, currency: 'KRW', payPeriod: 'YEARLY' }),
    ).toEqual({ ok: false, reason: 'UNSTATED' });
    expect(
      yearlyUsd({ min: 100, max: null, currency: null, payPeriod: 'YEARLY' }),
    ).toEqual({ ok: false, reason: 'UNSTATED' });
  });

  it('an incomparable period says so before any currency work', () => {
    expect(
      yearlyUsd({ min: 60, max: null, currency: 'USD', payPeriod: 'HOURLY' }),
    ).toEqual({ ok: false, reason: 'PERIOD_NOT_COMPARABLE' });
  });

  it('cross-currency with NO table is RATE_UNAVAILABLE — a distinct fact', () => {
    // Not "the employer said nothing" and not "they pay too little": our
    // rates are missing, and the caller is told exactly that.
    expect(
      normalizeSalary(
        { min: 40_000_000, max: null, currency: 'KRW', payPeriod: 'YEARLY' },
        'USD',
        'YEARLY',
        null,
      ),
    ).toEqual({ ok: false, reason: 'RATE_UNAVAILABLE' });
  });

  it('cross-currency with a table missing THAT currency is RATE_UNAVAILABLE', () => {
    expect(
      normalizeSalary(
        { min: 1_000, max: null, currency: 'XYZ', payPeriod: 'YEARLY' },
        'USD',
        'YEARLY',
        TABLE,
      ),
    ).toEqual({ ok: false, reason: 'RATE_UNAVAILABLE' });
  });

  it('hourly against hourly compares without inventing a year', () => {
    const result = normalizeSalary(
      { min: 80_000, max: null, currency: 'KRW', payPeriod: 'HOURLY' },
      'USD',
      'HOURLY',
      TABLE,
    );
    expect(result).toMatchObject({
      ok: true,
      salary: { payPeriod: 'HOURLY', min: 58 },
    });
  });
});
