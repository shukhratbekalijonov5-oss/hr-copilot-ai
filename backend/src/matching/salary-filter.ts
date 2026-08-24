/*
 * NOT CURRENTLY CALLED — kept deliberately.
 *
 * Find Jobs made pay a SOFT ranking dimension (see search-alignment.ts), so
 * nothing turns a salary floor into a WHERE clause today. This file is the
 * implementation of the strict salary mode the product may add later, and it
 * carries a lesson that cost a live 500 to learn: converting 200,000 USD to
 * UZS produces 2,560,000,000, which overflows the INTEGER column the query
 * compares against. Deleting it would delete that guard along with it.
 */
import type { PayPeriod } from '../generated/prisma/enums';
import { convert, toYearly, type RateTable } from '../fx/money';
import type { Prisma } from '../generated/prisma/client';

/**
 * One branch of the generated `where`.
 *
 * This module is the one place in the matching folder that knows about the
 * database, because a filter IS a query — the salary MATCHER next door stays
 * Prisma-free so external jobs can use it.
 */
type SalaryFilterBranch = Prisma.VacancyWhereInput;

/**
 * A salary floor a candidate typed into a search, expressed as a database
 * filter across every currency a job might be quoted in.
 *
 * ## Why this is not a simple `salaryMin >= x`
 *
 * A candidate asking for "at least 20,000 USD" is asking about VALUE, not
 * about the number an employer happened to type. A Korean job paying
 * 40,000,000 KRW clears that bar; a naive numeric comparison would either
 * exclude it (20,000 > nothing) or include every KRW job on earth. So the
 * threshold is converted INTO each currency once, and the query asks each job
 * about its own currency.
 *
 * ## What it deliberately does NOT remove
 *
 * Only jobs that are KNOWN, COMPARABLE and BELOW the floor. A job with no
 * stated salary stays; a job in a currency the rate table does not cover
 * stays; an hourly rate against a yearly expectation stays. The candidate
 * asked to filter out jobs that pay too little — not to filter out jobs whose
 * pay we could not read, which would silently hide postings for a gap in our
 * data rather than a fact about the job.
 */

/**
 * Postgres `integer` range. `salaryMin`/`salaryMax` are INTEGER columns, so a
 * threshold above this cannot be compared against them at all — the database
 * rejects the query outright. Converting 200,000 USD into UZS produces
 * 2,560,000,000, which is exactly that case.
 */
const PG_INT_MAX = 2_147_483_647;

export interface SalaryFloor {
  amount: number;
  currency: string;
  payPeriod: PayPeriod;
}

/**
 * Currencies whose rate is usable right now: the floor's own currency always
 * (no conversion needed) plus everything the snapshot covers.
 */
function comparableCurrencies(
  floor: SalaryFloor,
  table: RateTable | null,
): string[] {
  const own = floor.currency.toUpperCase();
  if (!table) return [own];
  const codes = new Set<string>([own, table.baseCurrency.toUpperCase()]);
  for (const code of Object.keys(table.rates)) codes.add(code.toUpperCase());
  return [...codes].sort();
}

/**
 * The floor restated in `currency` at `period`, or null if it cannot be.
 *
 * Rounds DOWN so a borderline job is kept rather than dropped: the cost of
 * showing a job a fraction under the line is nothing, and the cost of hiding
 * one a fraction over it is a job the candidate wanted and never saw.
 */
export function thresholdIn(
  floor: SalaryFloor,
  currency: string,
  period: PayPeriod,
  table: RateTable | null,
): number | null {
  const yearlyFloor = toYearly(floor.amount, floor.payPeriod);
  if (yearlyFloor === null) {
    // An hourly expectation only compares with hourly pay.
    if (period !== 'HOURLY' || floor.payPeriod !== 'HOURLY') return null;
    const sameUnit = convertOrSame(
      floor.amount,
      floor.currency,
      currency,
      table,
    );
    return sameUnit === null ? null : Math.floor(sameUnit);
  }
  if (period === 'HOURLY') return null;

  const converted = convertOrSame(yearlyFloor, floor.currency, currency, table);
  if (converted === null) return null;
  // The job's own number is per month when payPeriod is MONTHLY, so the
  // yearly threshold has to come back down to that scale for the comparison.
  const scaled = period === 'MONTHLY' ? converted / 12 : converted;
  return Math.floor(scaled);
}

function convertOrSame(
  amount: number,
  from: string,
  to: string,
  table: RateTable | null,
): number | null {
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  if (!table) return null;
  return convert(amount, from, to, table);
}

/**
 * A Prisma `where` fragment implementing "pays at least this much, or we
 * cannot tell".
 *
 * Returns null when nothing can be filtered at all (no usable threshold in any
 * currency), which callers should read as "apply no salary filter" rather than
 * "match nothing".
 */
export function salaryFloorFilter(
  floor: SalaryFloor,
  table: RateTable | null,
): SalaryFilterBranch | null {
  const periods: PayPeriod[] = ['YEARLY', 'MONTHLY', 'HOURLY'];
  const meets: SalaryFilterBranch[] = [];

  for (const currency of comparableCurrencies(floor, table)) {
    for (const period of periods) {
      const threshold = thresholdIn(floor, currency, period, table);
      if (threshold === null) continue;
      // A threshold no stored salary could ever reach. Skipping the branch is
      // both correct — no job in this currency can meet it — and necessary:
      // the comparison itself would be out of range for the column.
      if (threshold > PG_INT_MAX) continue;
      // The top of a job's band is what it can actually pay. A posting with
      // only a floor ("from ₩40M") is judged on that floor.
      meets.push({
        currency,
        payPeriod: period,
        OR: [
          { salaryMax: { gte: threshold } },
          { AND: [{ salaryMax: null }, { salaryMin: { gte: threshold } }] },
        ],
      });
    }
  }

  // Everything we could not judge stays in the results — with an indicator in
  // the UI, never silently dropped.
  const unreadable: SalaryFilterBranch[] = [
    { AND: [{ salaryMin: null }, { salaryMax: null }] },
    { currency: null },
    { payPeriod: null },
  ];

  const comparable = comparableCurrencies(floor, table);
  if (comparable.length > 0) {
    // A currency outside the snapshot cannot be compared, so it is retained.
    unreadable.push({
      NOT: { currency: { in: comparable } },
    });
  }
  // An hourly rate against a yearly expectation (and vice versa) is retained.
  if (floor.payPeriod !== 'HOURLY') {
    unreadable.push({ payPeriod: 'HOURLY' });
  }

  if (meets.length === 0) return null;
  return { OR: [...meets, ...unreadable] };
}
