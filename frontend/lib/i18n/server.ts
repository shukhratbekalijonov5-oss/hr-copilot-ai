import "server-only";

import { cookies, headers } from "next/headers";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionary";
import {
  LOCALE_COOKIE,
  isLocale,
  matchAcceptLanguage,
  type Locale,
} from "@/lib/i18n/locales";

/**
 * Resolving the reader's locale, server-side.
 *
 * There is exactly one store: the `hrc_locale` cookie. `Accept-Language` is
 * consulted only when that cookie is absent — a first visit — and the result is
 * never written back from here, because a Server Component cannot set cookies.
 * The cookie is written once, by the locale action, when a person chooses.
 *
 * The backend has no `preferredLocale` on a user, so this preference lives in
 * the browser and does not follow the account to another device. That gap is
 * stated in the UI rather than papered over with a second, competing store.
 */
export async function getLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;

  return matchAcceptLanguage((await headers()).get("accept-language"));
}

/** The active locale together with its dictionary. */
export async function getI18n(): Promise<{ locale: Locale; d: Dictionary }> {
  const locale = await getLocale();
  return { locale, d: getDictionary(locale) };
}

/** Convenience for server components that only need the strings. */
export async function getTranslations(): Promise<Dictionary> {
  return getDictionary(await getLocale());
}
