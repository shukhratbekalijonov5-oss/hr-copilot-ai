import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import { toJobRequirement, toVacancy } from "@/lib/api/adapters";
import type {
  JobRequirementResponse,
  VacancyResponse,
} from "@/lib/api/contracts";
import type {
  CreateVacancyInput,
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
