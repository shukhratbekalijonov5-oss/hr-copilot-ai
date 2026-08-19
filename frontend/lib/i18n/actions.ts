"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  toLocale,
} from "@/lib/i18n/locales";

/**
 * Stores the reader's language choice.
 *
 * `toLocale` narrows whatever the form submitted to one of the four supported
 * codes, so an unsupported value can never reach the cookie — and therefore can
 * never reach the backend, which rejects an unknown locale with a 400.
 *
 * The cookie is readable by scripts on purpose: it holds a display preference,
 * not a credential, and no security decision is made from it.
 */
export async function setLocaleAction(value: string): Promise<void> {
  const locale = toLocale(value);

  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
  });

  // Every page's copy depends on the cookie, so the whole tree is re-rendered.
  revalidatePath("/", "layout");
}
