import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/api/session";
import type { SessionUser } from "@/lib/types";

/**
 * The authorization boundary for pages.
 *
 * `proxy.ts` does a cheap cookie-presence check to keep signed-out users off
 * application routes, but a cookie is not proof of a valid session — only the
 * backend can say that. Every protected page calls `requireSession()`, which
 * verifies the token against GET /auth/me and redirects on failure.
 *
 * `cache` dedupes it to one request per render pass even when the layout and
 * several components all ask for the user.
 */
export const getCurrentSession = cache(
  async (): Promise<SessionUser | null> => {
    const token = await getSessionToken();
    if (!token) return null;

    try {
      return await api.getSession(token);
    } catch (error) {
      // A revoked or expired token is a signed-out user, not a crash. Anything
      // else (the API being down) must surface as a real error.
      if (error instanceof ApiError && error.isAuthFailure) return null;
      throw error;
    }
  },
);

export async function requireSession(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}
