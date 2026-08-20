import "server-only";

import { cookies } from "next/headers";
import { REFRESH_COOKIE, SESSION_COOKIE } from "@/lib/config";
import { forgetTokens, rememberTokens, type TokenPair } from "@/lib/auth/refresh";

/**
 * Where the browser session lives.
 *
 * The backend is bearer-token based. Rather than handing either token to
 * browser JavaScript, both are kept in httpOnly cookies that only the Next.js
 * server can read, and the access token is attached server-side as
 * `Authorization: Bearer`. That keeps them out of reach of any XSS on the page
 * while leaving the API transport-neutral for a future mobile client.
 *
 * `server-only` makes importing this from a client component a build error.
 *
 * Writes are only legal in a Server Action or Route Handler — a Server
 * Component render cannot set cookies. Proxy performs the proactive refresh
 * before rendering starts precisely so that renders never need to.
 */

/**
 * Both cookies outlive the access token on purpose.
 *
 * The access token is valid for 15 minutes, but the cookie holding it lives as
 * long as the refresh session: an expired access token still tells us which
 * session it belonged to, and losing it early would only force an extra
 * refresh. The backend's 30-day absolute session lifetime is the real bound.
 */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
} as const;

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  return (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
}

/**
 * Writes a token pair.
 *
 * Both cookies are replaced together: a state where the access token is new and
 * the refresh token is stale would replay a rotated credential on the next
 * refresh, which the backend treats as theft and answers by revoking the
 * session.
 */
export async function setSessionTokens(pair: TokenPair): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, pair.accessToken, COOKIE_OPTIONS);
  store.set(REFRESH_COOKIE, pair.refreshToken, COOKIE_OPTIONS);
  // Lets a concurrent request that still holds the previous cookie snapshot
  // resolve to this pair instead of replaying the old refresh token.
  rememberTokens(pair);
}

/**
 * Replaces only the access token.
 *
 * Used by organization switching, which the backend answers with a new access
 * token and deliberately does NOT rotate the refresh token: the workspace is
 * per-device context persisted on the session, not a new credential. Writing a
 * refresh token here would be inventing one.
 */
export async function setAccessToken(accessToken: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, accessToken, COOKIE_OPTIONS);
}

export async function clearSessionTokens(): Promise<void> {
  const store = await cookies();
  forgetTokens(store.get(REFRESH_COOKIE)?.value ?? null);
  store.delete(SESSION_COOKIE);
  store.delete(REFRESH_COOKIE);
}
