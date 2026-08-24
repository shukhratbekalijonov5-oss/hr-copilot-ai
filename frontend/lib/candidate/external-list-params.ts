import {
  EXTERNAL_APPLICATION_STATUSES,
  type ExternalApplicationStatus,
} from "@/lib/types";

/**
 * Reading the candidate-owned list URLs.
 *
 * A URL is user input, and these two are shareable. A hand-edited `?page=abc`
 * or `?status=BANANA` must narrow the request rather than produce a 400 page
 * for whoever opened the link — the same rule the external search already
 * follows for its own parameters.
 */

/** A one-based page number, or 1. Never NaN, never negative, never fractional. */
export function readPageParam(
  searchParams: Record<string, string | string[] | undefined>,
): number {
  const raw = searchParams.page;
  // A repeated `?page=` arrives as an array. Ambiguous input picks nothing
  // rather than silently choosing one of them.
  if (typeof raw !== "string") return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  // The backend caps `page` at 100_000; asking beyond it is a 400, so it is
  // clamped here instead.
  return Math.min(parsed, 100_000);
}

/**
 * The status filter, or nothing.
 *
 * Narrowed against the closed vocabulary the backend re-checks, so an unknown
 * value becomes "no filter" — a wider list the reader can see and correct —
 * rather than a rejected request.
 */
export function readStatusParam(
  searchParams: Record<string, string | string[] | undefined>,
): ExternalApplicationStatus | undefined {
  const raw = searchParams.status;
  if (typeof raw !== "string") return undefined;
  return (EXTERNAL_APPLICATION_STATUSES as readonly string[]).includes(raw)
    ? (raw as ExternalApplicationStatus)
    : undefined;
}
