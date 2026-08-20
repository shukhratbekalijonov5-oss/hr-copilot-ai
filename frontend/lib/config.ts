/**
 * Centralized runtime configuration.
 *
 * Nothing outside this module may hardcode a backend URL. Only NEXT_PUBLIC_*
 * values appear here, because everything in this file can end up in the client
 * bundle — server-only secrets must never be added.
 */

function readPublicApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");

  // A missing value is a deployment mistake, not something to paper over at
  // runtime. In development we fall back to the documented local port so the
  // app still boots; anywhere else this is fatal.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set. Copy .env.example to .env.local and set it to the NestJS API origin.",
    );
  }
  return "http://localhost:3001";
}

/** Origin of the NestJS application API, e.g. http://localhost:3001 */
export const API_ORIGIN = readPublicApiBaseUrl();

/** Base for REST calls — the NestJS global prefix is `api`. */
export const API_BASE_URL = `${API_ORIGIN}/api`;

/** socket.io namespace exposed by the processing gateway. */
export const PROCESSING_SOCKET_URL = `${API_ORIGIN}/processing`;

/**
 * Session cookies.
 *
 * Two separate httpOnly cookies rather than one blob: the access token is
 * short-lived (15 minutes) and replaced constantly, the refresh token is the
 * long-lived credential that must survive a browser restart. Splitting them
 * keeps the sensitive one out of every rewrite and makes an atomic swap of the
 * pair explicit at the one place that performs it.
 *
 * Neither is readable by browser JavaScript. `hrc_locale` is the only
 * script-readable cookie this app sets, and it holds a display preference.
 */
export const SESSION_COOKIE = "hrc_session";
export const REFRESH_COOKIE = "hrc_refresh";
