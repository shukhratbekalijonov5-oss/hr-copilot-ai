import { API_BASE_URL } from "@/lib/config";

/**
 * Refresh-token rotation, serialized.
 *
 * The backend rotates the refresh token on every call and treats a replayed
 * token as theft: presenting the previous token after a rotation returns
 * `AUTH_REFRESH_TOKEN_REUSED` and revokes the whole session. Two concurrent
 * refreshes are therefore not merely wasteful — the loser kills the session and
 * signs the user out of every tab.
 *
 * This module is the only place that calls `POST /auth/refresh`, and it makes
 * exactly one call per session no matter how many callers ask at once:
 *
 *   - `inflight` holds the promise of a refresh already in progress, keyed by
 *     session id. Concurrent callers await that same promise.
 *   - `rotated` remembers the freshly minted pair for a short window, so a
 *     caller that started with a cookie snapshot taken *before* the rotation
 *     gets the new pair instead of replaying the old token into a 401.
 *
 * Both maps are module state, which is shared because Next.js 16 runs Proxy and
 * the server render in the same Node.js process. Nothing here is a security
 * boundary — the backend re-validates every token — so a cold start simply
 * means one extra legitimate refresh.
 */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  accountType?: "CANDIDATE" | "ORGANIZATION";
  preferredLocale: string;
  role: string | null;
  organizationId: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export class RefreshFailedError extends Error {
  /** Backend machine-readable code, e.g. AUTH_REFRESH_TOKEN_REUSED. */
  readonly code: string | null;
  readonly status: number;

  constructor(code: string | null, status: number, message: string) {
    super(message);
    this.name = "RefreshFailedError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The opaque credential is `<sessionId>.<secret>`; only the secret rotates.
 * Keying on the session id therefore identifies the same session across every
 * rotation, which is exactly what the single-flight lock needs.
 */
export function sessionIdOf(refreshToken: string): string | null {
  const separator = refreshToken.indexOf(".");
  if (separator <= 0) return null;
  return refreshToken.slice(0, separator);
}

const inflight = new Map<string, Promise<TokenPair>>();
const rotated = new Map<string, { pair: TokenPair; at: number }>();

/**
 * How long a just-rotated pair answers for the token it replaced.
 *
 * Long enough to cover requests already in flight with an older cookie
 * snapshot, short enough that a genuinely stale token still reaches the backend
 * and fails honestly rather than being served from memory forever.
 */
const ROTATION_MEMORY_MS = 60_000;

/** Records a pair minted elsewhere (login, register) so refreshes dedupe. */
export function rememberTokens(pair: TokenPair): void {
  const sessionId = sessionIdOf(pair.refreshToken);
  if (sessionId) rotated.set(sessionId, { pair, at: Date.now() });
}

/** Drops remembered state for a session, e.g. after logout. */
export function forgetTokens(refreshToken: string | null): void {
  if (!refreshToken) return;
  const sessionId = sessionIdOf(refreshToken);
  if (!sessionId) return;
  rotated.delete(sessionId);
  inflight.delete(sessionId);
}

/** Test seam: clears all memory between cases. */
export function resetRefreshState(): void {
  inflight.clear();
  rotated.clear();
}

/**
 * Exchanges a refresh token for a new pair, at most once per session at a time.
 *
 * Callers must persist the returned pair; the caller that triggered the network
 * call and the callers that merely awaited it all receive the same object.
 */
export async function refreshSession(
  refreshToken: string,
): Promise<TokenPair> {
  const sessionId = sessionIdOf(refreshToken);
  if (!sessionId) {
    throw new RefreshFailedError(
      "AUTH_INVALID_REFRESH_TOKEN",
      401,
      "Malformed refresh token",
    );
  }

  const remembered = rotated.get(sessionId);
  if (remembered && Date.now() - remembered.at < ROTATION_MEMORY_MS) {
    // Only reuse the remembered pair when the caller is behind: if it already
    // holds the newest token, the access token it carries is fresh too.
    if (remembered.pair.refreshToken !== refreshToken) return remembered.pair;
  }

  const existing = inflight.get(sessionId);
  if (existing) return existing;

  const pending = performRefresh(refreshToken)
    .then((pair) => {
      rotated.set(sessionId, { pair, at: Date.now() });
      return pair;
    })
    .finally(() => {
      inflight.delete(sessionId);
    });

  inflight.set(sessionId, pending);
  return pending;
}

async function performRefresh(refreshToken: string): Promise<TokenPair> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
  } catch {
    // The API is unreachable. Not an invalid session — the caller must not
    // clear cookies over a transient network fault.
    throw new RefreshFailedError(null, 0, "Could not reach the server");
  }

  if (!response.ok) {
    let code: string | null = null;
    let message = "Refresh failed";
    try {
      const body = (await response.json()) as {
        code?: string;
        message?: string;
      };
      code = body.code ?? null;
      if (typeof body.message === "string") message = body.message;
    } catch {
      // A non-JSON error body carries nothing worth surfacing.
    }
    throw new RefreshFailedError(code, response.status, message);
  }

  return (await response.json()) as TokenPair;
}

/**
 * Seconds until the access token expires, read from the JWT's own `exp`.
 *
 * The payload is decoded, never verified: this only schedules a refresh, and
 * the backend remains the sole authority on whether a token is valid. A token
 * that cannot be parsed is treated as already expired, which triggers a refresh
 * rather than a silent 401 later.
 */
export function secondsUntilExpiry(accessToken: string): number {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return 0;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    ) as { exp?: number };
    if (typeof decoded.exp !== "number") return 0;
    return decoded.exp - Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

/**
 * Refresh a little before the token actually dies, so an ordinary request is
 * not spent discovering the expiry.
 */
export const REFRESH_SKEW_SECONDS = 60;

export function needsRefresh(accessToken: string | null): boolean {
  if (!accessToken) return true;
  return secondsUntilExpiry(accessToken) <= REFRESH_SKEW_SECONDS;
}
