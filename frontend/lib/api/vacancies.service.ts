import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import {
  toJobRequirement,
  toMyVacancy,
  toVacancy,
  toVacancyCandidate,
} from "@/lib/api/adapters";
import type {
  BulkDeleteVacanciesResponse,
  JobRequirementResponse,
  MyVacancyResponse,
  VacancyCandidateRowResponse,
  VacancyResponse,
} from "@/lib/api/contracts";
import type {
  ApplicationStatus,
  CreateVacancyInput,
  MyVacancy,
  VacancyCandidate,
  JobRequirement,
  JobRequirementInput,
  Vacancy,
  VacancyQuery,
  VacancyStatus,
} from "@/lib/types";

export interface VacancyPage {
  vacancies: Vacancy[];
  total: number;
  page: number;
  totalPages: number;
}

export async function getVacancies(
  query: VacancyQuery = {},
): Promise<VacancyPage> {
  const response = await apiFetch<Paginated<VacancyResponse>>("/vacancies", {
    query: {
      page: query.page ?? 1,
      limit: query.limit ?? 50,
      status: query.status,
      department: query.department,
      location: query.location,
      search: query.search,
    },
  });

  return {
    vacancies: response.data.map(toVacancy),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

/** Every vacancy, for filter dropdowns and the compare picker. */
export async function getAllVacancies(): Promise<Vacancy[]> {
  const rows = await fetchAllPages<VacancyResponse>("/vacancies");
  return rows.map(toVacancy);
}

export async function getVacancy(id: string): Promise<Vacancy> {
  return toVacancy(await apiFetch<VacancyResponse>(`/vacancies/${id}`));
}

export async function createVacancy(
  input: CreateVacancyInput,
): Promise<Vacancy> {
  return toVacancy(
    await apiFetch<VacancyResponse>("/vacancies", {
      method: "POST",
      body: input,
    }),
  );
}

export async function updateVacancy(
  id: string,
  input: Partial<CreateVacancyInput>,
): Promise<Vacancy> {
  return toVacancy(
    await apiFetch<VacancyResponse>(`/vacancies/${id}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

/**
 * Status changes. CLOSED and ARCHIVED have dedicated routes on the API;
 * DRAFT/OPEN go through the general update.
 */
export async function setVacancyStatus(
  id: string,
  status: VacancyStatus,
): Promise<Vacancy> {
  if (status === "CLOSED") {
    return toVacancy(
      await apiFetch<VacancyResponse>(`/vacancies/${id}/close`, {
        method: "PATCH",
      }),
    );
  }
  if (status === "ARCHIVED") {
    return toVacancy(
      await apiFetch<VacancyResponse>(`/vacancies/${id}/archive`, {
        method: "PATCH",
      }),
    );
  }
  return updateVacancy(id, { status });
}

export async function addRequirement(
  vacancyId: string,
  input: JobRequirementInput,
): Promise<JobRequirement> {
  return toJobRequirement(
    await apiFetch<JobRequirementResponse>(
      `/vacancies/${vacancyId}/requirements`,
      { method: "POST", body: input },
    ),
  );
}

export async function removeRequirement(
  vacancyId: string,
  requirementId: string,
): Promise<void> {
  await apiFetch<void>(`/vacancies/${vacancyId}/requirements/${requirementId}`, {
    method: "DELETE",
  });
}

/* -------------------------------------------------------------------------- */
/* Creator-scoped workspace                                                    */
/* -------------------------------------------------------------------------- */

export interface MyVacancyPage {
  vacancies: MyVacancy[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * GET /vacancies/mine — the ONLY source for creator-scoped selectors.
 *
 * `GET /vacancies` stays the organization-wide catalog and must not drive the
 * Compare, Candidate Detail or chat selectors: it lists
 * colleagues' vacancies, every one of which answers 403 VACANCY_NOT_OWNED as
 * soon as the user tries to work inside it.
 */
export async function getMyVacancies(
  query: { page?: number; limit?: number; status?: VacancyStatus; search?: string } = {},
): Promise<MyVacancyPage> {
  const response = await apiFetch<Paginated<MyVacancyResponse>>(
    "/vacancies/mine",
    {
      query: {
        page: query.page ?? 1,
        limit: query.limit ?? 50,
        status: query.status,
        search: query.search,
      },
    },
  );

  return {
    vacancies: response.data.map(toMyVacancy),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

/** Every vacancy the caller created — for selectors that show a full list. */
export async function getAllMyVacancies(): Promise<MyVacancy[]> {
  const rows = await fetchAllPages<MyVacancyResponse>("/vacancies/mine");
  return rows.map(toMyVacancy);
}

export interface VacancyCandidatePage {
  rows: VacancyCandidate[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * GET /vacancies/:vacancyId/candidates — who is in THIS pipeline.
 *
 * The picker source for Compare and the vacancy-scoped candidate list.
 * Returns manual and platform candidates in one shape, so nothing downstream
 * may assume a CandidateAccount exists.
 */
export async function getVacancyCandidates(
  vacancyId: string,
  query: { page?: number; limit?: number; search?: string; status?: ApplicationStatus } = {},
): Promise<VacancyCandidatePage> {
  const response = await apiFetch<Paginated<VacancyCandidateRowResponse>>(
    `/vacancies/${vacancyId}/candidates`,
    {
      query: {
        page: query.page ?? 1,
        limit: query.limit ?? 100,
        search: query.search,
        status: query.status,
      },
    },
  );

  return {
    rows: response.data.map(toVacancyCandidate),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

/** DELETE /vacancies/:id — creator-only. */
export async function deleteVacancy(id: string): Promise<void> {
  await apiFetch<void>(`/vacancies/${id}`, { method: "DELETE" });
}

/** Backend cap for one bulk-delete request. */
export const MAX_BULK_DELETE_VACANCIES = 50;

/**
 * POST /vacancies/bulk-delete — all-or-nothing.
 *
 * One foreign id (404) or one colleague-owned id (403) rejects the WHOLE
 * batch and deletes nothing, so the UI must not optimistically remove rows.
 */
export async function bulkDeleteVacancies(
  vacancyIds: string[],
): Promise<{ deletedIds: string[]; deletedCount: number }> {
  return apiFetch<BulkDeleteVacanciesResponse>("/vacancies/bulk-delete", {
    method: "POST",
    body: { vacancyIds },
  });
}
