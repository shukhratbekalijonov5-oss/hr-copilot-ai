import "server-only";

import { apiFetch, type Paginated } from "@/lib/api/http";
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
