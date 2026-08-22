import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import { toApplication, toCandidate } from "@/lib/api/adapters";
import type {
  ApplicationResponse,
  CandidateResponse,
} from "@/lib/api/contracts";
import type {
  CandidateCurrentEvidence,
  Candidate,
  CandidateQuery,
  UpdateCandidateInput,
} from "@/lib/types";

/**
 * Attaches applications to candidates from a list response.
 *
 * `GET /candidates` rows already carry the LIVE identity (name, email,
 * avatar) and the CURRENT document count/statuses; what they lack is the
 * application list, which screens use for the primary-vacancy column and the
 * compare picker. One org-scoped `/applications` call closes that for the
 * whole page instead of one detail call per candidate.
 */
async function withNestedCollections(
  candidates: Candidate[],
): Promise<Candidate[]> {
  if (candidates.length === 0) return candidates;

  const applicationRows = await fetchAllPages<ApplicationResponse>(
    "/applications",
  );

  const applicationsByCandidate = new Map<string, ApplicationResponse[]>();
  for (const row of applicationRows) {
    const bucket = applicationsByCandidate.get(row.candidateId);
    if (bucket) bucket.push(row);
    else applicationsByCandidate.set(row.candidateId, [row]);
  }

  return candidates.map((candidate) => {
    const source = applicationsByCandidate.get(candidate.id) ?? [];
    const applications = source.map(toApplication);
    const primary = applications[0];

    return {
      ...candidate,
      applications,
      primaryVacancyId: primary?.vacancyId ?? null,
      primaryVacancyTitle: primary?.vacancy?.title ?? null,
    };
  });
}

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
    candidates: await withNestedCollections(response.data.map(toCandidate)),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

export async function getAllCandidates(): Promise<Candidate[]> {
  const rows = await fetchAllPages<CandidateResponse>("/candidates");
  return withNestedCollections(rows.map(toCandidate));
}

export async function getCandidate(id: string): Promise<Candidate> {
  return toCandidate(await apiFetch<CandidateResponse>(`/candidates/${id}`));
}

/**
 * GET /candidates/:id/current-evidence — the applicant's LIVE profile,
 * documents and professional links, authorized through the caller's own
 * vacancy. The response shape is already display-ready; no adapter needed.
 */
export async function getCandidateCurrentEvidence(
  candidateId: string,
  vacancyId: string,
): Promise<CandidateCurrentEvidence> {
  return apiFetch<CandidateCurrentEvidence>(
    `/candidates/${candidateId}/current-evidence?vacancyId=${encodeURIComponent(vacancyId)}`,
  );
}

/** Signed URL for one of the applicant's CURRENT documents. */
export async function getCandidateCurrentDocumentUrl(
  candidateId: string,
  vacancyId: string,
  documentId: string,
): Promise<{ url: string; originalFileName: string; mimeType: string }> {
  return apiFetch(
    `/candidates/${candidateId}/current-documents/${documentId}/download-url?vacancyId=${encodeURIComponent(vacancyId)}`,
  );
}

/**
 * There is no createCandidate: `POST /candidates` was removed from the API.
 * A candidate record exists because a person applied — see
 * backend/docs/candidate-entry-model.md.
 */
export async function updateCandidate(
  id: string,
  input: UpdateCandidateInput,
): Promise<Candidate> {
  return toCandidate(
    await apiFetch<CandidateResponse>(`/candidates/${id}`, {
      method: "PATCH",
      body: input,
    }),
  );
}
