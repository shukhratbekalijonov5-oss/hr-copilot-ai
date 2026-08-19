import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/config";

/**
 * Session handling.
 *
 * The backend issues a bearer JWT. Rather than handing that token to browser
 * JavaScript, it is kept in an httpOnly cookie that only the Next.js server can
 * read, and attached to backend calls server-side. That keeps the token out of
 * reach of any XSS on the page — the practical equivalent of a session cookie
 * on top of a bearer-only API.
 *
 * `server-only` makes importing this from a client component a build error.
 */

/** Backend TOKEN_TTL is 24h by default; the cookie must not outlive it. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setSessionToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
