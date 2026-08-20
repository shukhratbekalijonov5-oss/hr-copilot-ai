import "server-only";

import { apiFetch, type Paginated } from "@/lib/api/http";
import { toPublicJob, toPublicJobDetail } from "@/lib/api/adapters";
import type {
  DirectApplicationResponse,
  PublicJobDetailResponse,
  PublicJobResponse,
} from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/errors";
import type { PublicJobDetail, PublicJobPage } from "@/lib/types";

/**
 * The public job board.
 *
 * Jobs are addressed by `publicSlug` only — no internal vacancy id is ever
 * exposed to a job seeker — and the backend returns advertisement-safe fields
 * alone: no applicant counts, no creator, no processing or evidence data. A
 * non-OPEN or unknown slug is a 404, indistinguishable by design.
 */

export interface PublicJobQuery {
  page?: number;
  limit?: number;
  search?: string;
  location?: string;
}

export async function getPublicJobs(
  query: PublicJobQuery = {},
): Promise<PublicJobPage> {
  const response = await apiFetch<Paginated<PublicJobResponse>>(
    "/public/jobs",
    {
      query: {
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        search: query.search?.trim() || undefined,
        location: query.location?.trim() || undefined,
      },
    },
  );

  return {
    jobs: response.data.map(toPublicJob),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

/** Null when the slug is unknown or the job is no longer OPEN. */
export async function getPublicJob(
  slug: string,
): Promise<PublicJobDetail | null> {
  try {
    return toPublicJobDetail(
      await apiFetch<PublicJobDetailResponse>(`/public/jobs/${slug}`),
    );
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") return null;
    throw error;
  }
}

/**
 * POST /public/jobs/:slug/apply.
 *
 * The backend does the whole flow: it snapshots the personal resume into the
 * hiring organization's own namespace, creates the org-side candidate and the
 * application, and queues AI processing of the copy. The personal resume itself
 * is never indexed for an organization.
 */
export function applyToJob(slug: string): Promise<DirectApplicationResponse> {
  return apiFetch<DirectApplicationResponse>(`/public/jobs/${slug}/apply`, {
    method: "POST",
  });
}
