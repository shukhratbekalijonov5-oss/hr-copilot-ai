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

/** socket.io namespace exposed by the interview chat gateway. */
export const CHAT_SOCKET_URL = `${API_ORIGIN}/chat`;

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

/**
 * Portfolio demo mode.
 *
 * This deployment doubles as a portfolio piece, so the demo plan switch — which
 * changes a plan WITHOUT taking payment — has to be visible on the public site.
 * That used to hang off `NODE_ENV !== "production"`, which is the wrong control
 * for the job: it conflates "how this bundle was compiled" with "is this a
 * showcase", so the only way to demo anything was to ship a development build.
 *
 * So the decision is now explicit and opt-in. The flag is read in exactly one
 * place, and it must be set to the literal string `true`; anything else —
 * unset, empty, `false`, `1`, `yes` — leaves demo mode OFF. A typo must fail
 * closed, because failing open here means handing every visitor a free upgrade.
 *
 * ## The frontend flag alone cannot grant a plan
 *
 * This only decides whether the control is DRAWN. The switch posts to the BFF,
 * which forwards to the payment service, where the endpoint exists only under
 * its own server-side profile. Turning this on without that server flag shows
 * a switch that answers "not available here" — visibly inert, not silently
 * privileged. Never treat this as an authorization boundary.
 *
 * ## Set it on the container, not in the build
 *
 * `NEXT_PUBLIC_*` is inlined when it is present at build time — build with
 * `true` and the image has `"true"` hardcoded, which can no longer be turned
 * off without rebuilding. Leave it UNSET at build and the compiler emits a
 * real `process.env` read instead, so the deployment can set it (and unset it)
 * on the pod. Prefer that: it keeps one image for both modes and keeps the
 * default off.
 *
 * That works because the only reader is a Server Component. A client component
 * reading this would need the value at build time, and the runtime toggle
 * would silently stop working — so keep the flag on the server side of the
 * boundary and pass it down as a prop, which is what `CandidatePlansView`
 * does.
 */
export function parsePortfolioDemoFlag(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

/** True only where this build is an explicitly flagged portfolio demo. */
export const PORTFOLIO_DEMO = parsePortfolioDemoFlag(
  process.env.NEXT_PUBLIC_PORTFOLIO_DEMO_MODE,
);
