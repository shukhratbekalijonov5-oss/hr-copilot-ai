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
  /**
   * HARD. ISO 3166-1 alpha-2 codes chosen for THIS search; empty means no
   * country restriction. The only secondary dimension that removes jobs.
   */
  countries?: string[];
  /**
   * SOFT. A SAVED country preference: ranks matching jobs first, hides
   * nothing. Kept apart from `countries` because a saved location is not a
   * decision about this search.
   */
  preferredCountries?: string[];
  /** SOFT — ranks matching jobs first; never removes the others. */
  workModes?: string[];
  /** SOFT. */
  employmentTypes?: string[];
  /** SOFT. */
  seniorityLevels?: string[];
  /**
   * SOFT. A pay floor with the units that make it meaningful. All three
   * travel together — an amount alone cannot be compared with any job's pay.
   *
   * `salaryCurrency` says how to READ the amount, and is never a filter on the
   * job's own currency: asking for 20,000 USD must still surface a Korean job
   * priced in won.
   */
  salaryMin?: number;
  salaryCurrency?: string;
  payPeriod?: string;
}

/** A list parameter, or undefined when the dimension is unrestricted. */
const listParam = (values?: string[]): string | undefined =>
  values && values.length > 0 ? values.join(",") : undefined;

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
        countries: listParam(query.countries),
        preferredCountries: listParam(query.preferredCountries),
        workModes: listParam(query.workModes),
        employmentTypes: listParam(query.employmentTypes),
        seniorityLevels: listParam(query.seniorityLevels),
        // The salary triple is sent only when complete: a floor with no
        // currency is not a filter, it is a number.
        salaryMin:
          query.salaryMin && query.salaryCurrency && query.payPeriod
            ? query.salaryMin
            : undefined,
        salaryCurrency:
          query.salaryMin && query.salaryCurrency && query.payPeriod
            ? query.salaryCurrency
            : undefined,
        payPeriod:
          query.salaryMin && query.salaryCurrency && query.payPeriod
            ? query.payPeriod
            : undefined,
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
