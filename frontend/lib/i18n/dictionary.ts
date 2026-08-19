/**
 * The locale → dictionary registry.
 *
 * `Dictionary` is derived from the English dictionary, so every other locale is
 * checked against it at compile time: a key that exists in English and not in
 * Korean fails `yarn typecheck` instead of rendering English text on a Korean
 * screen.
 *
 * Imports are static rather than dynamic so the registry can be used from tests
 * and from synchronous server code. Client components never import this module
 * — the active dictionary reaches them as a prop from the root layout, so the
 * browser only ever receives the one locale in use.
 */
import en from "@/lib/i18n/dictionaries/en";
import ko from "@/lib/i18n/dictionaries/ko";
import ru from "@/lib/i18n/dictionaries/ru";
import uz from "@/lib/i18n/dictionaries/uz";
import { LOCALES, type Locale } from "@/lib/i18n/locales";

export type Dictionary = typeof en;

const DICTIONARIES: Record<Locale, Dictionary> = { en, ko, ru, uz };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** Every dictionary, for tests that assert all four stay in step. */
export const ALL_DICTIONARIES: ReadonlyArray<{
  locale: Locale;
  dictionary: Dictionary;
}> = LOCALES.map((locale) => ({ locale, dictionary: DICTIONARIES[locale] }));
