import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { PAGE_SIZE, usePagedQuery } from "@/lib/query/pagination";
import { queryKeys } from "@/lib/query/keys";
import type { PublicJob } from "@/types";

/**
 * Ordinary job search — the one that is not AI and not gated.
 *
 * ## The query is the search, and the location filter is the only filter
 *
 * That is the backend's contract, not a simplification for a small screen:
 * work mode, employment type, seniority and pay RANK results rather than
 * excluding them. A mobile filter sheet that pretended to exclude by those
 * dimensions would return jobs that contradict it.
 *
 * ## The text parameter is `search`
 *
 * Not `q`. The API runs `forbidNonWhitelisted`, so an unknown query parameter
 * is a 400 rather than one that is ignored — this endpoint returned nothing
 * but bad requests until the contract audit caught it.
 */
export function usePublicJobs(query: string, location: string, enabled: boolean) {
  return usePagedQuery<PublicJob>(
    queryKeys.jobs.public(`${query}|${location}`, 0),
    "/public/jobs",
    {
      query: { search: query || undefined, location: location || undefined },
      enabled,
    },
  );
}

export function usePublicJob(slug: string | null) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(slug ?? ""),
    queryFn: () => apiFetch<PublicJob>(`/public/jobs/${slug}`),
    enabled: Boolean(slug),
  });
}

export { PAGE_SIZE };

/**
 * Save and unsave, with the list invalidated rather than patched.
 *
 * Patching the cache by hand would need this file to know the shape of every
 * page a slug might appear in — the search list, the saved list, a match
 * list. Invalidating lets the server say what is true, which is the only
 * thing that stays correct when a job closes between the two calls.
 */
export function useSaveJob() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ slug, saved }: { slug: string; saved: boolean }) =>
      apiFetch<void>(`/candidate-account/me/saved-jobs/${slug}`, {
        method: saved ? "DELETE" : "POST",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["candidate", "savedJobs"] });
      void client.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useApplyToJob() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (slug: string) =>
      apiFetch<{ id: string }>(`/public/jobs/${slug}/apply`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["candidate", "applications"] });
      void client.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
