/**
 * Locale-aware formatting.
 *
 * Dates, times and numbers are built from the dictionary rather than from
 * `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` / `Intl.NumberFormat`,
 * because those read the host's ICU tables and Node's and the browser's do not
 * agree. Measured on this project: for `uz`, Node produces "20-avg, 2026" and
 * Chrome "2026 M08 20"; relative time is "5 daqiqa oldin" against "-5 min";
 * numbers are "12 345,6" against "12,345.6". Any of those differences between
 * the server render and the client hydration is a React hydration mismatch,
 * and a mismatch does not merely warn — it can leave event handlers unattached,
 * which showed up here as tabs that stopped responding.
 *
 * `Intl.PluralRules` is kept: its categories are identical in both runtimes for
 * all four locales, and reimplementing Russian plural rules by hand would be
 * strictly worse.
 *
 * Timestamps render in UTC. A server in one timezone and a reader in another
 * must produce the same string, and a stable value is worth more here than a
 * few hours of local precision on "added" and "updated" metadata.
 */
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Plural } from "@/lib/i18n/dictionaries/en";
import { LOCALE_META, type Locale } from "@/lib/i18n/locales";

export type FormatValues = Record<string, string | number>;

/**
 * Fills `{name}` placeholders in a translated string.
 *
 * A placeholder with no matching value is left as-is rather than replaced with
 * "undefined": a visible `{count}` is a bug report, a silent "undefined" is a
 * shipped defect.
 */
export function format(template: string, values: FormatValues = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Picks a plural form with the locale's own rules.
 *
 * Korean has a single form, English and Uzbek have two, Russian has four. Using
 * `Intl.PluralRules` rather than `count === 1` is what makes "2 кандидата" and
 * "5 кандидатов" both come out right.
 */
export function plural(
  forms: Plural,
  count: number,
  locale: Locale,
  values: FormatValues = {},
): string {
  const category = new Intl.PluralRules(LOCALE_META[locale].htmlLang).select(
    count,
  );

  const template =
    (category === "one" && forms.one) ||
    (category === "few" && forms.few) ||
    (category === "many" && forms.many) ||
    forms.other;

  return format(template, { count, ...values });
}

/** Groups digits with the locale's own separators. Deterministic by design. */
export function formatNumber(value: number, d: Dictionary): string {
  const negative = value < 0;
  const [whole, fraction] = Math.abs(value).toString().split(".");

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, d.datetime.groupSeparator);
  const body = fraction
    ? `${grouped}${d.datetime.decimalSeparator}${fraction}`
    : grouped;

  return negative ? `-${body}` : body;
}

const pad = (value: number) => String(value).padStart(2, "0");

interface UtcParts {
  year: number;
  monthIndex: number;
  day: number;
  hour: number;
  minute: number;
}

function utcParts(value: string): UtcParts | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

export function formatDateFor(value: string, d: Dictionary): string {
  const parts = utcParts(value);
  // An unparseable timestamp is shown as-is rather than as "Invalid Date".
  if (!parts) return value;

  return format(d.datetime.date, {
    year: parts.year,
    month: d.datetime.months[parts.monthIndex],
    day: parts.day,
  });
}

export function formatDateTimeFor(value: string, d: Dictionary): string {
  const parts = utcParts(value);
  if (!parts) return value;

  return format(d.datetime.dateTime, {
    year: parts.year,
    month: d.datetime.months[parts.monthIndex],
    day: parts.day,
    time: format(d.datetime.time, {
      hour: pad(parts.hour),
      minute: pad(parts.minute),
    }),
  });
}

/**
 * Relative time in the reader's language.
 *
 * Anything older than 30 days falls back to an absolute date, which reads
 * better than "412 days ago" and matches what the previous implementation did.
 */
export function formatRelativeTimeFor(
  value: string,
  d: Dictionary,
  locale: Locale,
  now: number = Date.now(),
): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;

  const elapsedMs = now - timestamp;
  if (elapsedMs < 60_000) return d.datetime.justNow;

  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 60) return plural(d.datetime.minutesAgo, minutes, locale);

  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(d.datetime.hoursAgo, hours, locale);

  const days = Math.round(hours / 24);
  if (days < 30) return plural(d.datetime.daysAgo, days, locale);

  return formatDateFor(value, d);
}
