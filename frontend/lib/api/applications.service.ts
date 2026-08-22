import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import { toApplication } from "@/lib/api/adapters";
import type { ApplicationResponse } from "@/lib/api/contracts";
import type { Application, ApplicationStatus } from "@/lib/types";

export async function getApplications(query: {
  vacancyId?: string;
  candidateId?: string;
  status?: ApplicationStatus;
  page?: number;
  limit?: number;
}): Promise<{ applications: Application[]; total: number }> {
  const response = await apiFetch<Paginated<ApplicationResponse>>(
    "/applications",
    {
      query: {
        page: query.page ?? 1,
        limit: query.limit ?? 100,
        vacancyId: query.vacancyId,
        candidateId: query.candidateId,
        status: query.status,
      },
    },
  );

  return {
    applications: response.data.map(toApplication),
    total: response.meta.total,
  };
}

/**
 * Every application for one vacancy, across pages.
 *
 * The applicant list is grouped by candidate before it is rendered, and
 * grouping a single page would be wrong in both directions: a candidate whose
 * attempts straddle a page boundary would appear on two pages, and a page of
 * 100 attempts can be far fewer than 100 people. So the grouping input is the
 * whole set, and paging — if the screen ever needs it — belongs on the grouped
 * rows, not on the attempts underneath them.
 *
 * `fetchAllPages` caps the walk; past the cap this screen needs a real
 * candidate-level aggregate from the API rather than more round trips.
 */
export async function getAllApplications(query: {
  vacancyId?: string;
  candidateId?: string;
  status?: ApplicationStatus;
}): Promise<Application[]> {
  const rows = await fetchAllPages<ApplicationResponse>("/applications", {
    vacancyId: query.vacancyId,
    candidateId: query.candidateId,
    status: query.status,
  });
  return rows.map(toApplication);
}

/*
 * There is no createApplication: `POST /applications` was removed. An
 * application exists because the candidate applied to the vacancy.
 */

/**
 * Moves an application to another stage. This is always a person's action —
 * nothing in the product changes an application's status automatically.
 */
export async function setApplicationStatus(
  id: string,
  status: ApplicationStatus,
): Promise<Application> {
  return toApplication(
    await apiFetch<ApplicationResponse>(`/applications/${id}/status`, {
      method: "PATCH",
      body: { status },
    }),
  );
}
