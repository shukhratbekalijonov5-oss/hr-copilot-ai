import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Plural } from "@/lib/i18n/dictionaries/en";
import type { FormatValues } from "@/lib/i18n/format";

/**
 * "Posted 3 days ago" — and the several ways of getting it wrong.
 *
 * ## What this may and may not be built from
 *
 * Only `employerPostedAt`: the date the employer's own source states the
 * listing was published. Never `firstSeenAt` (when this product's crawler
 * first saw it), never `lastSeenAt` (when a source last listed it), never the
 * database row's `createdAt`. A job discovered this morning may have been
 * published in March, and the difference is invisible once it reaches a
 * screen — which is exactly why the search response carries none of those
 * three fields for a client to reach for.
 *
 * ## Why the reference time is a parameter
 *
 * The page renders on the server and hydrates in the browser, so a label
 * computed from `Date.now()` in both places can disagree — a search that
 * crosses midnight renders "2 days ago" on the server and "3 days ago" in the
 * browser. That is a React hydration mismatch, which this project has already
 * been bitten by: it does not merely warn, it can leave event handlers
 * unattached. The server passes the moment it rendered at, and both passes
 * compute from the same number.
 *
 * ## Why UTC
 *
 * Day boundaries are counted in UTC, matching the rest of this app's date
 * rendering (see `lib/i18n/format.ts`). A candidate a few hours either side of
 * UTC may see "Yesterday" for something posted very late or very early in
 * their own day; the alternative — reading the browser's timezone — would make
 * the server and client disagree again, and would trade a rare off-by-one for
 * a guaranteed hydration bug.
 */

/** Days of relative wording before the label becomes an absolute date. */
export const RELATIVE_POSTING_DAYS = 6;

export type PostedAge =
  | { kind: "TODAY" }
  | { kind: "YESTERDAY" }
  | { kind: "DAYS"; days: number }
  /** Old enough that a calendar date reads better than a count. */
  | { kind: "DATE" };

/** Whole days between two instants, counted on the UTC calendar. */
function utcDaysBetween(from: Date, to: Date): number {
  const day = (date: Date) =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/**
 * How old a posting is, as a shape the caller renders.
 *
 * Returns null for an absent or unparseable date, which the UI renders as
 * silence — the honest output for half this catalogue, whose provider states
 * no publication date at all.
 *
 * A date slightly in the future is treated as TODAY rather than refused: the
 * backend already rejects anything beyond a two-day skew, so what reaches here
 * is a timezone edge, and "Posted in 4 hours" would be a worse answer than
 * "Posted today".
 */
export function postedAge(
  postedAt: string | null,
  now: number,
): PostedAge | null {
  if (!postedAt) return null;
  const posted = new Date(postedAt);
  if (Number.isNaN(posted.getTime())) return null;

  const days = utcDaysBetween(posted, new Date(now));
  if (days <= 0) return { kind: "TODAY" };
  if (days === 1) return { kind: "YESTERDAY" };
  if (days <= RELATIVE_POSTING_DAYS) return { kind: "DAYS", days };
  return { kind: "DATE" };
}

/**
 * The line a card shows, in the reader's language.
 *
 * Each locale owns its whole sentence — "Posted 3 days ago", "3일 전 게시",
 * "Опубликовано 3 дня назад", "3 kun oldin joylangan" — rather than a shared
 * template with a translated fragment dropped into it. Korean and Uzbek put
 * the verb last and Russian inflects the noun with the number, so an English
 * sentence with a substituted middle would be wrong in three languages at
 * once.
 */
export function postedLabel(
  postedAt: string | null,
  now: number,
  d: Dictionary,
  helpers: {
    p: (forms: Plural, count: number, values?: FormatValues) => string;
    date: (value: string) => string;
    f: (template: string, values?: FormatValues) => string;
  },
): string | null {
  const age = postedAge(postedAt, now);
  if (!age || !postedAt) return null;

  switch (age.kind) {
    case "TODAY":
      return d.externalJobs.postedToday;
    case "YESTERDAY":
      return d.externalJobs.postedYesterday;
    case "DAYS":
      return helpers.p(d.externalJobs.postedDaysAgo, age.days);
    case "DATE":
      return helpers.f(d.externalJobs.postedOn, {
        date: helpers.date(postedAt),
      });
  }
}
