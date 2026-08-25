import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import type { ExternalJob, ExternalSearchResult, Paginated } from "@/types";

/**
 * External job search — jobs published on other companies' boards.
 *
 * ## A POST, and paging is the same POST
 *
 * The backend stores the ranking it produced and re-reads it for page 2,
 * which is what keeps the second page consistent with the first. Turning
 * this into a GET per page would recompute and could interleave a job the
 * reader already scrolled past.
 *
 * ## MAX-gated, and the gate is the backend's
 *
 * A 403 `PLAN_UPGRADE_REQUIRED` is the only signal that this is locked. The
 * app never decides entitlement itself — it renders whatever the server
 * refuses or returns.
 */
/** This endpoint pages by `pageSize`, not `limit`. Its own convention. */
const EXTERNAL_PAGE_SIZE = 20;

/**
 * The next page of an external search snapshot.
 *
 * ## `total`, never `matched`
 *
 * `total` is how many results the stored snapshot HOLDS — exactly what
 * pagination covers. `matched` counts jobs answering the hard filters in the
 * database, which is usually larger and occasionally smaller. Paging on it
 * would offer pages the snapshot cannot serve.
 *
 * A snapshot can also shrink between requests — a job closes, a source drops
 * out. An in-range page that returns nothing is the end of the list, not an
 * error, and must not loop.
 */
export function nextExternalPage(
  last: ExternalSearchResult | undefined,
): number | undefined {
  if (!last) return undefined;
  if ((last.results ?? []).length === 0) return undefined;
  return last.page * last.pageSize < last.total ? last.page + 1 : undefined;
}

export function useExternalSearch(
  query: string,
  countries: string[],
  enabled: boolean,
) {
  const result = useInfiniteQuery({
    queryKey: queryKeys.candidate.externalJobs(
      `${query}|${countries.join(",")}`,
      0,
    ),
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiFetch<ExternalSearchResult>(
        "/candidate-account/me/external-jobs/search",
        {
          method: "POST",
          body: {
            query: query || undefined,
            countries: countries.length > 0 ? countries : undefined,
            page: pageParam,
            pageSize: EXTERNAL_PAGE_SIZE,
          },
        },
      ),
    getNextPageParam: nextExternalPage,
    // Ranking is expensive and the inputs rarely change within a session.
    staleTime: 5 * 60 * 1000,
  });

  const results = (result.data?.pages ?? []).flatMap((page) => page.results ?? []);
  const first = result.data?.pages?.[0];

  return Object.assign(result, {
    results,
    total: first?.total ?? 0,
    degraded: first?.degraded ?? false,
  });
}

export function useSavedExternalJobs(page = 1) {
  return useQuery({
    queryKey: ["candidate", "externalJobs", "saved", page] as const,
    queryFn: () =>
      apiFetch<Paginated<{ job: ExternalJob; savedAt: string }>>(
        "/candidate-account/me/external-jobs/saved",
        { query: { page, limit: 20 } },
      ),
  });
}

/** Bookmark, or remove one. Both are idempotent on the backend. */
export function useSaveExternalJob() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) =>
      apiFetch<void>(
        `/candidate-account/me/external-jobs/${encodeURIComponent(id)}/save`,
        { method: saved ? "DELETE" : "POST" },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["candidate", "externalJobs"] });
    },
  });
}

/**
 * "Why this job matches you" — a MAX feature, generated on demand.
 *
 * A mutation rather than a query because it is explicitly asked for: it costs
 * a generation pass, and a query would fire it on every mount and every
 * refocus. It deliberately carries no score and no band — the prose explains,
 * the ranking scores, and blurring the two would invite reading the sentence
 * as a number.
 */
export function useWhyMatch() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ text: string }>(
        `/candidate-account/me/external-jobs/${encodeURIComponent(id)}/why-match`,
        { method: "POST" },
      ),
  });
}
