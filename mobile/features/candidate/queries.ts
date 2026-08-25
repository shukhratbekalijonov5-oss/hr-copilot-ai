import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import { PAGE_SIZE, usePagedQuery } from "@/lib/query/pagination";
import type {
  CandidateEvidenceState,
  JobMatch,
  MyApplication,
  SavedJob,
} from "@/types";

/**
 * Candidate server state. Every one of these is an endpoint the web client
 * already calls; the mobile app adds no route and changes no shape.
 */
export function useMyApplications() {
  return usePagedQuery<MyApplication>(
    queryKeys.candidate.applications(0),
    "/candidate-account/me/applications",
  );
}

export function useSavedJobs() {
  return usePagedQuery<SavedJob>(
    queryKeys.candidate.savedJobs(0),
    "/candidate-account/me/saved-jobs",
  );
}

export function useEvidenceState() {
  return useQuery({
    queryKey: queryKeys.candidate.evidence,
    queryFn: () =>
      apiFetch<CandidateEvidenceState>("/candidate-account/me/evidence"),
  });
}

/** The envelope the ranking endpoint returns. Flat, not `{data, meta}`. */
interface JobMatchPage {
  matches: JobMatch[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** The backend's own answer about whether more exist. */
  hasMore: boolean;
  generated: boolean;
  explanationsPending: boolean;
  stale: boolean;
}

/**
 * The next page of the stored ranking, straight from the server's `hasMore`.
 *
 * No arithmetic on `total`: the response states whether more exist, and
 * re-deriving it here would be a second opinion that can only disagree. An
 * empty page still ends the list, because `hasMore` can lag a snapshot that
 * shrank between two reads.
 */
export function nextJobMatchPage(last: JobMatchPage | undefined): number | undefined {
  if (!last?.hasMore) return undefined;
  if ((last.matches ?? []).length === 0) return undefined;
  return last.page + 1;
}

/**
 * AI job matches.
 *
 * ## A POST, and paging is the same POST
 *
 * Ranking is a computation the backend performs and STORES; page 2 is a slice
 * of that finished ranking, not a fresh search. `refresh` is deliberately
 * never sent while paging — it would recompute and reshuffle the list under
 * the reader mid-scroll.
 *
 * ## `hasMore` comes from the server
 *
 * The response states it directly, so this does no arithmetic on `total`.
 * The ranked count and the page count are the server's business; deriving
 * them again here would be a second opinion that can only ever disagree.
 */
export function useJobMatches(locale: string, enabled: boolean) {
  const result = useInfiniteQuery({
    queryKey: queryKeys.candidate.jobMatches(locale, 0),
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiFetch<JobMatchPage>("/candidate-account/me/job-matches", {
        method: "POST",
        body: { locale, page: pageParam, limit: PAGE_SIZE },
      }),
    getNextPageParam: nextJobMatchPage,
    // Ranking is expensive server-side; do not re-run it on every remount.
    staleTime: 5 * 60_000,
  });

  const matches = (result.data?.pages ?? []).flatMap((page) => page.matches ?? []);
  const first = result.data?.pages?.[0];

  return Object.assign(result, {
    matches,
    total: first?.total ?? 0,
    generated: first?.generated ?? false,
    explanationsPending: first?.explanationsPending ?? false,
    stale: first?.stale ?? false,
  });
}
