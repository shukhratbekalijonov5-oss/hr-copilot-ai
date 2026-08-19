"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Dictionary } from "@/lib/i18n/dictionary";
import {
  format,
  formatDateFor,
  formatDateTimeFor,
  formatNumber,
  formatRelativeTimeFor,
  plural,
  type FormatValues,
} from "@/lib/i18n/format";
import type { Plural } from "@/lib/i18n/dictionaries/en";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The active locale, for client components.
 *
 * Only the dictionary in use crosses the server/client boundary — it arrives as
 * a plain-object prop from the root layout — so the browser never downloads all
 * four locales. That is also why nothing in a dictionary may be a function.
 */
export interface I18n {
  locale: Locale;
  /** The active dictionary. Access is typed: `d.candidates.title`. */
  d: Dictionary;
  /** Fills `{name}` placeholders. */
  f: (template: string, values?: FormatValues) => string;
  /** Selects a plural form with the locale's own rules. */
  p: (forms: Plural, count: number, values?: FormatValues) => string;
  n: (value: number) => string;
  date: (value: string) => string;
  dateTime: (value: string) => string;
  relativeTime: (value: string, now?: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo<I18n>(
    () => ({
      locale,
      d: dictionary,
      f: format,
      p: (forms, count, values) => plural(forms, count, locale, values),
      n: (value) => formatNumber(value, dictionary),
      date: (value) => formatDateFor(value, dictionary),
      dateTime: (value) => formatDateTimeFor(value, dictionary),
      relativeTime: (value, now) =>
        formatRelativeTimeFor(value, dictionary, locale, now),
    }),
    [locale, dictionary],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Reads the active locale.
 *
 * Throws rather than falling back to English: a component rendering outside the
 * provider would silently ship untranslated text, which is exactly the bug this
 * layer exists to prevent.
 */
export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside <I18nProvider>.");
  }
  return value;
}
