import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REFRESH_SKEW_SECONDS,
  RefreshFailedError,
  forgetTokens,
  needsRefresh,
  refreshSession,
  rememberTokens,
  resetRefreshState,
  secondsUntilExpiry,
  sessionIdOf,
  type TokenPair,
} from "@/lib/auth/refresh";

const SESSION = "11111111-2222-3333-4444-555555555555";

function token(secret: string): string {
  return `${SESSION}.${secret}`;
}

function pair(secret: string): TokenPair {
  return {
    accessToken: "header.payload.signature",
    refreshToken: token(secret),
    user: {
      id: "u1",
      email: "a@b.test",
      fullName: "A B",
      preferredLocale: "en",
      role: null,
      organizationId: null,
    },
  };
}

/** A JWT with a real `exp`, unsigned — only the payload is ever read. */
function accessTokenExpiringIn(seconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetRefreshState();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetRefreshState();
});

describe("sessionIdOf", () => {
  it("reads the stable session id out of the opaque credential", () => {
    // Only the secret half rotates, so the id identifies the same session
    // across every rotation — which is what the single-flight lock keys on.
    expect(sessionIdOf(token("secret-a"))).toBe(SESSION);
    expect(sessionIdOf(token("secret-b"))).toBe(SESSION);
  });

  it("rejects a credential with no session part", () => {
    expect(sessionIdOf("nodot")).toBeNull();
    expect(sessionIdOf(".onlysecret")).toBeNull();
  });
});

describe("secondsUntilExpiry / needsRefresh", () => {
  it("reads the JWT's own exp claim", () => {
    expect(secondsUntilExpiry(accessTokenExpiringIn(900))).toBeGreaterThan(880);
  });

  it("treats an unparseable token as already expired", () => {
    // Better one wasted refresh than a silent 401 later.
    expect(secondsUntilExpiry("not-a-jwt")).toBe(0);
    expect(needsRefresh("not-a-jwt")).toBe(true);
  });

  it("refreshes slightly before the real expiry", () => {
    expect(needsRefresh(accessTokenExpiringIn(REFRESH_SKEW_SECONDS - 5))).toBe(
      true,
    );
    expect(needsRefresh(accessTokenExpiringIn(900))).toBe(false);
  });

  it("treats a missing token as needing a refresh", () => {
    expect(needsRefresh(null)).toBe(true);
  });
});

describe("refreshSession — single flight", () => {
  it("makes exactly ONE backend call for many simultaneous callers", async () => {
    // The backend revokes a session whose refresh token is replayed, so a
    // second concurrent call would not merely be wasteful — it would sign the
    // user out of every tab.
    let resolve: ((value: Response) => void) | undefined;
    const calls = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    globalThis.fetch = calls as unknown as typeof fetch;

    const waiting = Array.from({ length: 10 }, () =>
      refreshSession(token("old")),
    );

    expect(calls).toHaveBeenCalledTimes(1);

    resolve!(
      new Response(JSON.stringify(pair("new")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const results = await Promise.all(waiting);
    expect(calls).toHaveBeenCalledTimes(1);
    // Every caller receives the same rotated pair.
    for (const result of results) {
      expect(result.refreshToken).toBe(token("new"));
    }
  });

  it("serialises callers that arrive while a refresh is in flight", async () => {
    let resolve: ((value: Response) => void) | undefined;
    const calls = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    globalThis.fetch = calls as unknown as typeof fetch;

    const first = refreshSession(token("old"));
    const second = refreshSession(token("old"));

    resolve!(
      new Response(JSON.stringify(pair("new")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect((await first).refreshToken).toBe((await second).refreshToken);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("answers a stale token from rotation memory instead of replaying it", async () => {
    // A request whose cookie snapshot predates the rotation must NOT present
    // the old token again — that is exactly what the backend calls theft.
    const calls = vi.fn(
      async () =>
        new Response(JSON.stringify(pair("new")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = calls as unknown as typeof fetch;

    await refreshSession(token("old"));
    expect(calls).toHaveBeenCalledTimes(1);

    const late = await refreshSession(token("old"));
    expect(late.refreshToken).toBe(token("new"));
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("still refreshes when the caller already holds the newest token", async () => {
    const calls = vi.fn(
      async () =>
        new Response(JSON.stringify(pair("newest")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = calls as unknown as typeof fetch;

    rememberTokens(pair("current"));
    await refreshSession(token("current"));
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("releases the lock so a later expiry refreshes again", async () => {
    const calls = vi.fn(
      async () =>
        new Response(JSON.stringify(pair("second")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = calls as unknown as typeof fetch;

    await refreshSession(token("a"));
    resetRefreshState();
    await refreshSession(token("b"));
    expect(calls).toHaveBeenCalledTimes(2);
  });
});

describe("refreshSession — failures", () => {
  it("surfaces the backend's machine-readable code", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          statusCode: 401,
          message: "Refresh token was already used",
          code: "AUTH_REFRESH_TOKEN_REUSED",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    await expect(refreshSession(token("replayed"))).rejects.toMatchObject({
      code: "AUTH_REFRESH_TOKEN_REUSED",
      status: 401,
    });
  });

  it("distinguishes an unreachable API from an invalid session", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const error = await refreshSession(token("x")).catch((e) => e);
    expect(error).toBeInstanceOf(RefreshFailedError);
    // status 0 and no code: a network fault must not clear the session.
    expect(error.status).toBe(0);
    expect(error.code).toBeNull();
  });

  it("does not cache a failure, so the next attempt retries", async () => {
    const calls = vi.fn(async () =>
      new Response("{}", { status: 500 }),
    );
    globalThis.fetch = calls as unknown as typeof fetch;

    await refreshSession(token("a")).catch(() => undefined);
    await refreshSession(token("a")).catch(() => undefined);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed credential without calling the API", async () => {
    const calls = vi.fn();
    globalThis.fetch = calls as unknown as typeof fetch;

    await expect(refreshSession("garbage")).rejects.toMatchObject({
      code: "AUTH_INVALID_REFRESH_TOKEN",
    });
    expect(calls).not.toHaveBeenCalled();
  });
});

describe("rotation memory lifecycle", () => {
  it("forgetTokens clears the memory so a fresh call hits the API", async () => {
    const calls = vi.fn(
      async () =>
        new Response(JSON.stringify(pair("new")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = calls as unknown as typeof fetch;

    await refreshSession(token("old"));
    forgetTokens(token("old"));

    await refreshSession(token("old"));
    expect(calls).toHaveBeenCalledTimes(2);
  });
});
