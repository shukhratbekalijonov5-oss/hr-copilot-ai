/**
 * The four locales this product supports.
 *
 * The list is deliberately identical to the backend's `SUPPORTED_LOCALES`
 * (backend/src/ai/ai-service.client.ts). Every AI generation request carries one
 * of these codes, and the backend rejects anything else with a 400 — so a locale
 * the UI can select but the API cannot serve must not exist.
 */
export const LOCALES = ["en", "ko", "ru", "uz"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Name of the cookie holding the reader's locale. The only locale store. */
export const LOCALE_COOKIE = "hrc_locale";

/** A year: the choice is a preference, not a session value. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Narrows any input to a supported locale.
 *
 * Used at every boundary that can carry an unvalidated string — the cookie, a
 * form field, an `Accept-Language` header — so no code path can hand the
 * backend a locale it will reject.
 */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export interface LocaleMeta {
  /** Endonym: each language is named in itself, never translated. */
  label: string;
  /** BCP-47 tag for `<html lang>` and Intl formatting. */
  htmlLang: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  en: { label: "English", htmlLang: "en" },
  ko: { label: "한국어", htmlLang: "ko" },
  ru: { label: "Русский", htmlLang: "ru" },
  uz: { label: "O‘zbekcha", htmlLang: "uz" },
};

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Only used for a first visit, before any cookie exists. Region subtags are
 * matched on their language part, so `ru-RU` and `ko-KR` resolve correctly.
 */
export function matchAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((entry) => entry.tag && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const language = tag.split("-")[0];
    if (isLocale(language)) return language;
  }

  return DEFAULT_LOCALE;
}
