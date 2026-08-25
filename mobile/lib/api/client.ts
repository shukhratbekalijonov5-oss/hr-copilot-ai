import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "@/constants/config";
import { ApiError, parseErrorBody } from "@/lib/api/errors";
import {
  clearTokens,
  readTokens,
  writeTokens,
  type TokenPair,
} from "@/lib/storage/secure";

/**
 * The one way this app talks to the backend.
 *
 * ## Tokens live here and in SecureStore, nowhere else
 *
 * An in-memory copy avoids a keychain read on every request; the keychain is
 * the durable truth restored at launch. No screen, store or query ever holds
 * a token, so no accidental render or log can expose one.
 *
 * ## Refresh happens once, not once per caller
 *
 * When several queries fire together and the access token has expired, they
 * would each try to refresh — and because the backend ROTATES refresh tokens,
 * the second attempt would present a token the first just invalidated and log
 * the user out. `refreshInFlight` collapses them onto one attempt whose
 * result everybody awaits.
 *
 * ## Nothing here decides authorization
 *
 * The client attaches a bearer token and normalises failures. Whether a
 * caller may see a vacancy, a candidate or a plan is settled by the backend;
 * a 401 clears the session, a 403 is surfaced as a refusal, and neither is
 * ever second-guessed locally.
 */
let memoryTokens: TokenPair | null = null;
let refreshInFlight: Promise<TokenPair | null> | null = null;

/** Called when the session ends for good, so the app can route to sign-in. */
type SessionEndedListener = () => void;
let onSessionEnded: SessionEndedListener | null = null;

export function setSessionEndedListener(listener: SessionEndedListener | null) {
  onSessionEnded = listener;
}

/**
 * Notified whenever the access token changes.
 *
 * The websocket authenticates with the token it was handed at connect time.
 * After a rotation that token is dead, so a socket that outlives a refresh is
 * connected on a credential the server has already invalidated — it keeps
 * working until the next reconnect, then silently fails to authenticate. The
 * realtime layer subscribes here and reconnects with the new one.
 *
 * A Set rather than a single listener: nothing today needs two, and a
 * registry that silently replaces its only subscriber is a bug waiting for
 * the second caller.
 */
type TokenChangeListener = (accessToken: string | null) => void;
const tokenListeners = new Set<TokenChangeListener>();

export function onAccessTokenChange(listener: TokenChangeListener): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

function announceToken(): void {
  for (const listener of tokenListeners) {
    listener(memoryTokens?.accessToken ?? null);
  }
}

export async function restoreSession(): Promise<TokenPair | null> {
  memoryTokens = await readTokens();
  return memoryTokens;
}

export function currentAccessToken(): string | null {
  return memoryTokens?.accessToken ?? null;
}

export async function setSession(pair: TokenPair): Promise<void> {
  memoryTokens = pair;
  await writeTokens(pair);
  announceToken();
}

export async function endSession(): Promise<void> {
  memoryTokens = null;
  refreshInFlight = null;
  await clearTokens();
  // Sockets learn of a sign-out here and disconnect; the router follows.
  announceToken();
  onSessionEnded?.();
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skips the bearer header and the refresh retry — for login/register. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await performRequest(path, options);

  /*
   * 401 on an authenticated call means the access token expired or the
   * session was revoked. One refresh attempt, then one replay. If the refresh
   * fails the session is genuinely over — a second retry would only turn a
   * revoked session into a retry loop.
   */
  if (response.status === 401 && !options.anonymous) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      await endSession();
      throw new ApiError("Session expired.", 401, "unauthorized");
    }
    const replay = await performRequest(path, options);
    return readResponse<T>(replay);
  }

  return readResponse<T>(response);
}

async function performRequest(
  path: string,
  options: RequestOptions,
): Promise<Response> {
  const url = buildUrl(path, options.query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // The caller's own cancellation (a screen unmounting) must still work
  // alongside the timeout, so both feed the one controller.
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!options.anonymous && memoryTokens) {
    headers.Authorization = `Bearer ${memoryTokens.accessToken}`;
  }

  try {
    return await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    // An aborted request is either our timeout or the caller's cancel; both
    // are network-shaped from a screen's point of view, and neither should
    // surface a DOMException message.
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new ApiError(
      aborted ? "The request timed out." : "Could not reach the server.",
      0,
      aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text.length > 0 ? safeJson(text) : null;

  if (!response.ok) {
    throw parseErrorBody(parsed, response.status, "Something went wrong.");
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Rotates the refresh token, collapsing concurrent callers onto one attempt.
 *
 * The refresh call is deliberately `anonymous`: the refresh token IS the
 * credential, and an expired access token must not be able to block a
 * refresh.
 */
async function refreshSession(): Promise<TokenPair | null> {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = memoryTokens?.refreshToken;
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const pair = await apiFetch<TokenPair>("/auth/refresh", {
        method: "POST",
        body: { refreshToken },
        anonymous: true,
      });
      if (!pair?.accessToken || !pair?.refreshToken) return null;
      await setSession(pair);
      return pair;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function buildUrl(
  path: string,
  query: RequestOptions["query"],
): string {
  const base = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return base;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }
  const serialized = params.toString();
  return serialized.length > 0 ? `${base}?${serialized}` : base;
}
