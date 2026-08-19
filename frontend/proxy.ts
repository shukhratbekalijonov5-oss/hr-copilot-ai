import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/config";

/**
 * Optimistic route protection.
 *
 * This only checks whether a session cookie is present — it never validates the
 * token, because proxy runs on every request and must stay cheap. The real
 * check is `requireSession()` in the authenticated layout, which verifies the
 * token against the backend. This layer exists to keep signed-out users from
 * seeing an application shell flash before that redirect happens.
 */

const AUTH_ROUTES = ["/login", "/register"];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (isAuthRoute) {
    // Signed-in users have no business on the sign-in screen.
    if (hasSession) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    // Preserve where they were headed so login can send them back.
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
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
