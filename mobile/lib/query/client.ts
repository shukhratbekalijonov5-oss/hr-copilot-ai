import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";

/**
 * Server state policy, in one place.
 *
 * ## What is NOT retried
 *
 * A 401/403/404 is a settled answer, not a flaky one — retrying a plan
 * refusal three times just delays the paywall by a few seconds and puts
 * avoidable load on the API. Only network-shaped failures get another go,
 * which on a phone is the case that genuinely resolves itself.
 *
 * ## Why staleTime is not zero
 *
 * Mobile remounts screens constantly as tabs and sheets come and go. With a
 * zero stale time every tab switch refetches everything over a cellular link.
 * Thirty seconds keeps navigation instant while still feeling live, and
 * mutations invalidate explicitly where freshness actually matters.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry(failureCount, error) {
          if (error instanceof ApiError) {
            if (
              error.kind === "unauthorized" ||
              error.kind === "forbidden" ||
              error.kind === "not_found" ||
              error.kind === "validation"
            ) {
              return false;
            }
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
