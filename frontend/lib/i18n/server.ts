import "server-only";

import { cookies, headers } from "next/headers";
import { getCurrentSession } from "@/lib/auth/session";
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
 * One writable store — the `hrc_locale` cookie — with two read-only fallbacks,
 * consulted in this order:
 *
 *  1. The cookie. Set by the locale action when a person chooses a language.
 *  2. `user.preferredLocale` from GET /auth/me. The account carries a stored
 *     language, so a signed-in user gets their own on a device that has never
 *     seen this cookie. The API exposes no field to *write* it (UpdateUserDto
 *     has no preferredLocale), so this is a seed, never a sync target.
 *  3. `Accept-Language`, for a first visit with no session.
 *
 * Nothing is written from here: a Server Component cannot set cookies, and a
 * second writable store would be a competing source of truth.
 */
export async function getLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;

  // `getCurrentSession` is React-cached, so on an authenticated page this
  // shares the request the layout already makes rather than adding one.
  try {
    const session = await getCurrentSession();
    if (session?.preferredLocale && isLocale(session.preferredLocale)) {
      return session.preferredLocale;
    }
  } catch {
    // The language a page renders in must not depend on the API being up.
  }

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
