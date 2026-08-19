import "server-only";

import { API_BASE_URL } from "@/lib/config";
import { getSessionToken } from "@/lib/api/session";
import { ApiError, apiErrorFromResponse, networkError } from "@/lib/api/errors";

/**
 * The one place the frontend talks to the NestJS API.
 *
 * Every request is server-side, so the JWT never enters the browser. There is
 * deliberately no way to pass an organizationId: the backend derives tenancy
 * from the token, and adding one here would create a client-controlled tenant
 * parameter that must not exist.
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

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const token =
    options.token === undefined ? await getSessionToken() : options.token;

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // FormData must set its own multipart boundary, so only JSON bodies get a
  // content-type here.
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      cache: options.cache ?? "no-store",
      signal: options.signal,
    });
  } catch {
    // DNS failure, connection refused, TLS error — the API is unreachable.
    throw networkError();
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("The server returned an unreadable response.", 502);
  }
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
