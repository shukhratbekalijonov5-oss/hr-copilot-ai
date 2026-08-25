/**
 * The one statement of the app's installed identity.
 *
 * The manifest, the Apple metadata, the theme-colour tags and the service
 * worker all read from here. Three copies of a colour is how an installed app
 * ends up with a splash screen that does not match the page it opens.
 */
export const PWA = {
  name: "HR Copilot AI",
  /** iOS truncates a home-screen label around 12 characters. */
  shortName: "HR Copilot",
  description:
    "AI-powered hiring and job discovery workspace for candidates and recruiters.",

  /*
   * The chrome colour, per theme.
   *
   * These are `--surface` from `globals.css`, NOT the brand. The browser
   * paints its own bars with this, and they sit directly against the app's
   * header — a brand-blue bar above a white header reads as a rendering
   * seam. The two must be the same surface.
   */
  themeColor: "#ffffff",
  themeColorDark: "#0b162a",

  /*
   * The splash colour, shown before the first paint. It is `--canvas`, the
   * page behind everything, so the launch surface and the loaded page are
   * the same colour and the app does not flash.
   */
  backgroundColor: "#f1f6fd",
} as const;

/** The service worker's URL. Registered by `ServiceWorkerRegistrar`. */
export const SERVICE_WORKER_URL = "/sw.js";

/**
 * Path prefixes the service worker must never cache.
 *
 * ## Why this list is here and not only in `sw.js`
 *
 * The worker needs it at runtime; the tests need it to prove the rule holds.
 * Keeping one exported constant means a route added to the app cannot be
 * quietly cached because somebody edited the worker and not the test.
 *
 * ## What is on it, and why
 *
 * Everything that is either a credential, somebody's private data, or a
 * payment. A cached `/api/auth/me` served to the next person to open the app
 * on a shared device is an account leak; a cached candidate list is a
 * confidentiality breach; a cached billing response is a lie about what
 * someone has paid for. None of these are performance wins worth having.
 */
export const NEVER_CACHE_PREFIXES = [
  "/api/",
  "/auth/",
  "/login",
  "/register",
  "/settings",
  "/plans",
] as const;

export function isCacheableRequest(pathname: string): boolean {
  return !NEVER_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
