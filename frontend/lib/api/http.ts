import "server-only";

import { API_BASE_URL } from "@/lib/config";
import {
  getRefreshToken,
  getSessionToken,
  setSessionTokens,
} from "@/lib/api/session";
import { refreshSession } from "@/lib/auth/refresh";
import { ApiError, apiErrorFromResponse, networkError } from "@/lib/api/errors";

/**
 * The one place the frontend talks to the NestJS API.
 *
 * Every request is server-side, so neither token ever enters the browser. There
 * is deliberately no way to pass an organizationId: the backend derives tenancy
 * from the token's membership, and adding one here would create a
 * client-controlled tenant parameter that must not exist.
 *
 * ## Expired access tokens
 *
 * Proxy refreshes proactively before a render starts, so this path is a safety
 * net for the case where a token expires *during* a request. On a 401 it
 * refreshes once — through the same single-flight lock, so ten parallel calls
 * still produce one `/auth/refresh` — and retries the original request exactly
 * once. There is no retry loop: a second 401 is reported as an auth failure.
 *
 * A 403 is never retried. "Your role does not allow this" and "your token
 * expired" are different problems, and refreshing on a role failure would spin
 * against a wall.
 */

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-serialisable body. Use `formData` for uploads instead. */
  body?: unknown;
  formData?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Overrides the bearer token, e.g. right after login before the cookie is set. */
  token?: string | null;
  /** Next.js cache behaviour; reads default to no-store for live data. */
  cache?: RequestCache;
  signal?: AbortSignal;
}

function buildUrl(
  path: string,
  query?: RequestOptions["query"],
): string {
  const url = new URL(
    `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`,
  );

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function send(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // FormData must set its own multipart boundary, so only JSON bodies get a
  // content-type here.
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body:
        options.formData ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
      cache: options.cache ?? "no-store",
      signal: options.signal,
    });
  } catch {
    // DNS failure, connection refused, TLS error — the API is unreachable.
    throw networkError();
  }
}

async function readBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("The server returned an unreadable response.", 502);
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const explicitToken = options.token !== undefined;
  const token = explicitToken ? options.token! : await getSessionToken();

  let response = await send(path, options, token);

  /**
   * One refresh, one retry.
   *
   * Skipped when the caller supplied its own token (login, and the retry
   * below): those either have no session to refresh or have already tried.
   * A body cannot be replayed from a consumed FormData stream either, so an
   * upload that races an expiry surfaces the 401 and is retried by the user.
   */
  if (
    response.status === 401 &&
    !explicitToken &&
    !options.formData
  ) {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      try {
        const pair = await refreshSession(refreshToken);
        // Best effort: a Server Component render cannot write cookies. The
        // rotated pair is still remembered in-process, so the next Proxy pass
        // persists it instead of replaying the token this request just used.
        await setSessionTokens(pair).catch(() => undefined);
        response = await send(path, options, pair.accessToken);
      } catch {
        // Fall through with the original 401; the caller decides what to show.
      }
    }
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  return readBody<T>(response);
}

/** Shape every paginated NestJS list endpoint returns. */
export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * Walks a paginated endpoint to completion.
 *
 * Used where the UI genuinely needs the full set (dashboard counts, compare).
 * Capped so a large tenant cannot turn one page render into hundreds of calls;
 * the cap is a signal that the screen needs a real backend aggregate.
 */
export async function fetchAllPages<T>(
  path: string,
  query: RequestOptions["query"] = {},
  maxPages = 5,
): Promise<T[]> {
  const limit = 100;
  const first = await apiFetch<Paginated<T>>(path, {
    query: { ...query, page: 1, limit },
  });

  const items = [...first.data];
  const pages = Math.min(first.meta.totalPages, maxPages);

  for (let page = 2; page <= pages; page += 1) {
    const next = await apiFetch<Paginated<T>>(path, {
      query: { ...query, page, limit },
    });
    items.push(...next.data);
  }

  return items;
}
