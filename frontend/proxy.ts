import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REFRESH_COOKIE, SESSION_COOKIE } from "@/lib/config";
import {
  RefreshFailedError,
  needsRefresh,
  refreshSession,
} from "@/lib/auth/refresh";

/**
 * Route protection and proactive token refresh.
 *
 * Two jobs, both of which have to happen before a page renders:
 *
 *  1. Keep signed-out visitors off application routes. This is optimistic —
 *     the presence of a cookie is not proof of a valid session. `requireSession()`
 *     in each layout verifies the token against the backend; this layer only
 *     avoids flashing an application shell before that redirect.
 *
 *  2. Refresh the access token *before* the render needs it. This is the only
 *     place that can: a Server Component may read cookies but never write them,
 *     so an expiry discovered mid-render could not persist the rotated pair.
 *     Proxy runs first, writes both cookies on the response, and rewrites the
 *     request cookies so the render that follows already sees the new token.
 *
 * Serialization matters more than usual here. The backend rotates the refresh
 * token on every call and treats a replay as theft — two concurrent refreshes
 * would revoke the session outright. `refreshSession` holds a single-flight
 * lock per session id, and Next.js 16 runs Proxy in the Node.js runtime, in the
 * same process as the render, so that lock covers both.
 */

const AUTH_ROUTES = ["/login", "/register"];

/** Reasons to give up on the session rather than retry it. */
const FATAL_REFRESH_CODES = new Set([
  "AUTH_INVALID_REFRESH_TOKEN",
  "AUTH_REFRESH_TOKEN_EXPIRED",
  "AUTH_REFRESH_TOKEN_REUSED",
  "AUTH_SESSION_REVOKED",
  "AUTH_SESSION_NOT_FOUND",
]);

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
};

/**
 * Sends the visitor to sign in, saying why when the backend told us.
 *
 * The reason travels as the backend's own machine-readable code, never as its
 * English message: the sign-in screen localizes it into all four languages. A
 * session that was revoked, replayed or simply expired each read differently,
 * and "please sign in again" with no explanation is the one thing that makes a
 * security event look like a bug.
 */
function signedOut(request: NextRequest, reason?: string | null): NextResponse {
  const { pathname, search } = request.nextUrl;
  const loginUrl = new URL("/login", request.url);
  // Preserve where they were headed so login can send them back.
  if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
  if (reason) loginUrl.searchParams.set("reason", reason);

  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get(SESSION_COOKIE)?.value ?? null;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value ?? null;

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  // No credentials at all: only the sign-in screens are reachable.
  if (!accessToken && !refreshToken) {
    return isAuthRoute ? NextResponse.next() : signedOut(request);
  }

  let rotated: { accessToken: string; refreshToken: string } | null = null;

  if (refreshToken && needsRefresh(accessToken)) {
    try {
      const pair = await refreshSession(refreshToken);
      rotated = {
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      };
    } catch (error) {
      const fatal =
        error instanceof RefreshFailedError &&
        (FATAL_REFRESH_CODES.has(error.code ?? "") || error.status === 401);

      if (fatal) {
        return signedOut(
          request,
          error instanceof RefreshFailedError ? error.code : null,
        );
      }
      // A network blip or a backend restart must not sign anyone out. Let the
      // request through: the render's own call will fail visibly instead, and
      // the next navigation retries the refresh.
    }
  }

  if (isAuthRoute) {
    // Already signed in — the landing route decides which workspace to open.
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!rotated) return NextResponse.next();

  // Hand the refreshed token to this render, and to the browser for the next.
  request.cookies.set(SESSION_COOKIE, rotated.accessToken);
  request.cookies.set(REFRESH_COOKIE, rotated.refreshToken);

  const response = NextResponse.next({
    request: { headers: request.headers },
  });
  response.cookies.set(SESSION_COOKIE, rotated.accessToken, COOKIE_OPTIONS);
  response.cookies.set(REFRESH_COOKIE, rotated.refreshToken, COOKIE_OPTIONS);
  return response;
}

export const config = {
  /*
   * Everything except Next internals, the frontend's own route handlers, and
   * static assets. Without the exclusions, auth redirects would also block CSS,
   * JS and images from loading.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
