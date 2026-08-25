import { createContext, useContext } from "react";
import en from "@/lib/i18n/en";

/**
 * The locale registry.
 *
 * `Dictionary` is derived from English, so the other three are checked
 * against it at compile time — a key that exists in English and not in
 * Uzbek fails the typecheck instead of rendering English on an Uzbek screen.
 *
 * Imports are static: React Native has no dynamic import at startup worth
 * paying for here, and four small objects cost less than the machinery to
 * defer them.
 */
export const LOCALES = ["en", "ko", "ru", "uz"] as const;
export type Locale = (typeof LOCALES)[number];
export type Dictionary = typeof en;

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
  ru: "Русский",
  uz: "Oʻzbekcha",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Substitutes `{name}` placeholders.
 *
 * Values are interpolated as-is and never parsed as markup — the dictionary
 * is our own copy, and a name or a count is the only thing that ever reaches
 * this function.
 */
export function format(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export interface I18nValue {
  locale: Locale;
  d: Dictionary;
  setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return value;
}
