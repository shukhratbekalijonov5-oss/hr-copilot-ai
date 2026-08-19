/**
 * Locale-aware formatting for interpolation, plurals, dates and numbers.
 *
 * Pure functions with no dictionary import, so client components can use them
 * without pulling four locales into the browser bundle.
 */
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

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_META[locale].htmlLang).format(value);
}

export function formatDateFor(value: string, locale: Locale): string {
  return new Date(value).toLocaleDateString(LOCALE_META[locale].htmlLang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTimeFor(value: string, locale: Locale): string {
  return new Date(value).toLocaleString(LOCALE_META[locale].htmlLang, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Relative time in the reader's language.
 *
 * `Intl.RelativeTimeFormat` is used instead of hand-written "5m ago" strings so
 * every locale gets its own grammar without four more dictionary entries.
 */
export function formatRelativeTimeFor(
  value: string,
  locale: Locale,
  now: number = Date.now(),
): string {
  const diffMs = new Date(value).getTime() - now;
  const minutes = Math.round(diffMs / 60_000);
  const tag = LOCALE_META[locale].htmlLang;
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });

  if (Math.abs(minutes) < 1) return relative.format(0, "minute");
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");

  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return relative.format(days, "day");

  return formatDateFor(value, locale);
}
