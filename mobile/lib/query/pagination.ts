import {
  useInfiniteQuery,
  type QueryKey,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import type { Paginated } from "@/types";

/**
 * The one way this app pages a `{data, meta}` list.
 *
 * ## Why a helper rather than an infinite query per screen
 *
 * The next-page rule is a single condition — `page < meta.totalPages` — and
 * getting it slightly wrong in one of eleven places produces a list that
 * either stops one page early or fetches forever. Stating it once means the
 * screens only choose a path and a page size.
 *
 * ## The page size is ours; the cap is the backend's
 *
 * 20 matches the server's default. The server refuses anything above 100 with
 * a 400 rather than silently widening, so this never needs to guess.
 */
export const PAGE_SIZE = 20;

/**
 * The next page of a `{data, meta}` list, or `undefined` at the end.
 *
 * Exported and pure so the rule can be tested directly rather than through a
 * rendered list. The `data.length` guard matters as much as the page count: a
 * list that shrinks between two requests can answer an in-range page with
 * nothing, and without this the pager keeps asking for pages that no longer
 * exist.
 */
export function nextStandardPage<T>(last: Paginated<T> | undefined): number | undefined {
  if (!last?.meta) return undefined;
  if ((last.data ?? []).length === 0) return undefined;
  return last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined;
}

export interface PagedOptions {
  /** Extra query parameters, merged with `page` and `limit`. */
  query?: Record<string, string | number | boolean | undefined | null>;
  enabled?: boolean;
  staleTime?: number;
}

export function usePagedQuery<T>(
  key: QueryKey,
  path: string,
  options: PagedOptions = {},
): UseInfiniteQueryResult<{ pages: Paginated<T>[] }, Error> & { rows: T[]; total: number } {
  const result = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiFetch<Paginated<T>>(path, {
        query: { ...options.query, page: pageParam, limit: PAGE_SIZE },
      }),
    getNextPageParam: nextStandardPage,
    enabled: options.enabled,
    staleTime: options.staleTime,
  });

  const rows = (result.data?.pages ?? []).flatMap((page) => page.data ?? []);
  // The server's count of the whole list, not of what has been loaded.
  const total = result.data?.pages?.[0]?.meta.total ?? 0;

  return Object.assign(result, { rows, total }) as never;
}

/**
 * The props a `FlatList` needs to page a `usePagedQuery` result.
 *
 * `onEndReachedThreshold` is half a screen: far enough ahead that the next
 * page usually lands before the reader arrives, close enough that opening a
 * list does not immediately fetch two pages nobody scrolled to.
 */
export function infiniteListProps(result: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}) {
  return {
    onEndReachedThreshold: 0.5,
    onEndReached: () => {
      if (result.hasNextPage && !result.isFetchingNextPage) result.fetchNextPage();
    },
  };
}
