import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import { toCandidate } from "@/lib/api/adapters";
import type { CandidateResponse } from "@/lib/api/contracts";
import type {
  Candidate,
  CandidateQuery,
  CreateCandidateInput,
} from "@/lib/types";

export interface CandidatePage {
  candidates: Candidate[];
  total: number;
  page: number;
  totalPages: number;
}

export async function getCandidates(
  query: CandidateQuery = {},
): Promise<CandidatePage> {
  const response = await apiFetch<Paginated<CandidateResponse>>("/candidates", {
    query: {
      page: query.page ?? 1,
      limit: query.limit ?? 50,
      search: query.search,
      location: query.location,
      currentTitle: query.currentTitle,
      minExperienceYears: query.minExperienceYears,
    },
  });

  return {
    candidates: response.data.map(toCandidate),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

export async function getAllCandidates(): Promise<Candidate[]> {
  const rows = await fetchAllPages<CandidateResponse>("/candidates");
  return rows.map(toCandidate);
}

export async function getCandidate(id: string): Promise<Candidate> {
  return toCandidate(await apiFetch<CandidateResponse>(`/candidates/${id}`));
}

export async function createCandidate(
  input: CreateCandidateInput,
): Promise<Candidate> {
  return toCandidate(
    await apiFetch<CandidateResponse>("/candidates", {
      method: "POST",
      body: input,
    }),
  );
}

export async function updateCandidate(
  id: string,
  input: Partial<CreateCandidateInput>,
): Promise<Candidate> {
  return toCandidate(
    await apiFetch<CandidateResponse>(`/candidates/${id}`, {
      method: "PATCH",
      body: input,
    }),
  );
}
