import type { PayPeriod } from '../generated/prisma/enums';

/**
 * Money, pay periods and currency conversion — exactly, and without a database.
 *
 * This module is the shared normalization layer the whole product compares
 * salaries through. It knows nothing about vacancies, candidates, Prisma or
 * any job provider: it takes amounts, currencies and pay periods, and answers
 * whether two of them are comparable and what one is worth in the other's
 * currency. That is what lets an internal vacancy and a future Greenhouse,
 * Lever, Ashby or Ninehire job go through ONE matcher — a provider only has to
 * produce `{salaryMin, salaryMax, currency, payPeriod}`, and per-provider
 * currency code is then never needed and never allowed.
 *
 * ## Why integers and BigInt
 *
 * A salary of 50,000,000 KRW multiplied by a float rate is where quiet
 * precision loss lives, and ranking must be deterministic: the same inputs
 * must produce the same order on every machine and every run. So rates are
 * scaled to fixed-point integers once and every conversion is exact BigInt
 * arithmetic with one explicit half-up rounding at the very end. Floats are
 * used nowhere in the money path; formatting for display is the frontend's
 * job and happens after all comparison is done.
 */

/**
 * Fixed-point scale for rates. 12 decimal places is far more than any provider
 * publishes and keeps every intermediate product well inside BigInt's exact
 * range.
 */
const RATE_SCALE = 10n ** 12n;

/** A rate table as fetched: how many units of X one BASE unit buys. */
export interface RateTable {
  baseCurrency: string;
  /** Currency code → units per one base unit. */
  rates: Record<string, number>;
}

/**
 * Two salaries can only be compared as numbers when they describe the same
 * span of time. These are the periods this product is willing to bridge.
 */
export type ComparablePeriod = 'YEARLY';

/**
 * A pay period expressed as YEARLY, or null when the product refuses to guess.
 *
 * MONTHLY → YEARLY is a definition (twelve months in a year) and is exact
 * integer multiplication. HOURLY → YEARLY is NOT a definition: it needs hours
 * per week and weeks per year, which vary by country, contract and employer,
 * and inventing 40 × 52 would silently fabricate a number the employer never
 * stated. So HOURLY compares only against HOURLY, and everything else is
 * NOT_COMPARABLE — a stated, visible outcome rather than a wrong one.
 *
 * Normalizing UPWARD (× 12) rather than downward (÷ 12) is deliberate: it
 * keeps the arithmetic exact, where dividing 40,000,000 by 12 would not be.
 */
export function toYearly(amount: number, period: PayPeriod): number | null {
  switch (period) {
    case 'YEARLY':
      return amount;
    case 'MONTHLY':
      return amount * 12;
    case 'HOURLY':
      return null;
    default:
      return null;
  }
}

/** Whether two pay periods can be brought onto one scale at all. */
export function periodsComparable(a: PayPeriod, b: PayPeriod): boolean {
  if (a === b) return true;
  return toYearly(1, a) !== null && toYearly(1, b) !== null;
}

function scaled(value: number): bigint {
  // Rates arrive as JSON numbers; this is the single place they stop being
  // floats. Anything non-finite or non-positive is not a rate.
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('rate must be a finite positive number');
  }
  return BigInt(Math.round(value * Number(RATE_SCALE)));
}

/**
 * `amount` of `from`, expressed in `to`, using one rate table.
 *
 * Returns null when either currency is absent from the table — an unknown rate
 * must never be silently treated as 1, which would compare 40,000,000 KRW
 * against a USD range as though they were the same unit.
 *
 * The conversion is `amount × rate(to) / rate(from)` in exact integer
 * arithmetic, rounded half-up once at the end. Converting a currency to
 * itself returns the amount untouched without consulting the table at all, so
 * same-currency comparison keeps working when FX is unavailable entirely.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  table: RateTable,
): number | null {
  const source = from.toUpperCase();
  const target = to.toUpperCase();
  if (source === target) return amount;
  if (!Number.isFinite(amount)) return null;

  const base = table.baseCurrency.toUpperCase();
  // The base currency is implicitly 1.0 and providers often omit it.
  const rawFrom = source === base ? 1 : table.rates[source];
  const rawTo = target === base ? 1 : table.rates[target];
  if (rawFrom === undefined || rawTo === undefined) return null;

  let fromScaled: bigint;
  let toScaled: bigint;
  try {
    fromScaled = scaled(rawFrom);
    toScaled = scaled(rawTo);
  } catch {
    return null;
  }

  const negative = amount < 0;
  const magnitude = BigInt(Math.round(Math.abs(amount)));
  const numerator = magnitude * toScaled;
  // Half-up: (n + d/2) / d, done without leaving integers.
  const rounded = (numerator * 2n + fromScaled) / (fromScaled * 2n);
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) return null;
  return negative ? -result : result;
}

/** Convenience: the effective rate from → to, for display or diagnostics. */
export function rateBetween(
  from: string,
  to: string,
  table: RateTable,
): number | null {
  const converted = convert(1_000_000_000, from, to, table);
  return converted === null ? null : converted / 1_000_000_000;
}

/**
 * A salary as any source states it, before any comparison.
 *
 * Both bounds are optional because employers state pay in all three shapes —
 * a floor only ("from ₩40M"), a ceiling only, or a band. `null` on both means
 * the employer said nothing, which is UNKNOWN and never zero.
 */
export interface SalaryRange {
  min: number | null;
  max: number | null;
  currency: string | null;
  payPeriod: PayPeriod | null;
}

/** A salary brought onto one currency and one period, ready to compare. */
export interface NormalizedSalary {
  min: number | null;
  max: number | null;
  currency: string;
  /** Always YEARLY unless both sides were HOURLY, which stays HOURLY. */
  payPeriod: PayPeriod;
  /** True when a currency conversion actually happened. */
  converted: boolean;
}

export type NormalizeFailure =
  'UNSTATED' | 'PERIOD_NOT_COMPARABLE' | 'RATE_UNAVAILABLE';

export type NormalizeResult =
  | { ok: true; salary: NormalizedSalary }
  | { ok: false; reason: NormalizeFailure };

/**
 * Brings one stated salary into the target currency and a comparable period.
 *
 * `table` may be null — that is the FX-unavailable case, and it is not an
 * error: a salary already quoted in the target currency still normalizes and
 * still compares. Only a genuine cross-currency comparison needs rates, and
 * only that case degrades to RATE_UNAVAILABLE.
 */
export function normalizeSalary(
  salary: SalaryRange,
  targetCurrency: string,
  targetPeriod: PayPeriod,
  table: RateTable | null,
): NormalizeResult {
  if (
    salary.currency === null ||
    salary.payPeriod === null ||
    (salary.min === null && salary.max === null)
  ) {
    return { ok: false, reason: 'UNSTATED' };
  }
  if (!periodsComparable(salary.payPeriod, targetPeriod)) {
    return { ok: false, reason: 'PERIOD_NOT_COMPARABLE' };
  }

  // HOURLY only ever meets HOURLY (periodsComparable guarantees it), and then
  // no period conversion is needed at all.
  const bothHourly = salary.payPeriod === 'HOURLY' && targetPeriod === 'HOURLY';
  const periodOf = (value: number | null): number | null =>
    value === null
      ? null
      : bothHourly
        ? value
        : toYearly(value, salary.payPeriod as PayPeriod);

  const yearlyMin = periodOf(salary.min);
  const yearlyMax = periodOf(salary.max);

  const source = salary.currency.toUpperCase();
  const target = targetCurrency.toUpperCase();
  if (source === target) {
    return {
      ok: true,
      salary: {
        min: yearlyMin,
        max: yearlyMax,
        currency: target,
        payPeriod: bothHourly ? 'HOURLY' : 'YEARLY',
        converted: false,
      },
    };
  }
  if (!table) return { ok: false, reason: 'RATE_UNAVAILABLE' };

  const min =
    yearlyMin === null ? null : convert(yearlyMin, source, target, table);
  const max =
    yearlyMax === null ? null : convert(yearlyMax, source, target, table);
  if (
    (yearlyMin !== null && min === null) ||
    (yearlyMax !== null && max === null)
  ) {
    return { ok: false, reason: 'RATE_UNAVAILABLE' };
  }

  return {
    ok: true,
    salary: {
      min,
      max,
      currency: target,
      payPeriod: bothHourly ? 'HOURLY' : 'YEARLY',
      converted: true,
    },
  };
}
