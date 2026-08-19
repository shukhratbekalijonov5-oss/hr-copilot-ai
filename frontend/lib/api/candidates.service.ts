import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import {
  aggregateDocumentStatus,
  toApplication,
  toCandidate,
  toDocument,
} from "@/lib/api/adapters";
import type {
  ApplicationResponse,
  CandidateResponse,
  DocumentResponse,
} from "@/lib/api/contracts";
import type {
  Candidate,
  CandidateQuery,
  CreateCandidateInput,
} from "@/lib/types";

/**
 * Attaches documents and applications to candidates from a list response.
 *
 * `GET /candidates` returns only `_count` for the nested collections — no
 * documents and no applications — while `GET /candidates/:id` returns both.
 * Screens built on the list therefore had no processing status and no vacancy
 * to filter by, which silently emptied the compare picker and left every row's
 * processing badge blank.
 *
 * The gap is closed with two extra list calls rather than one detail call per
 * candidate: `/documents` and `/applications` are both organization-scoped and
 * carry `candidateId`, so a page of candidates costs three requests instead of
 * N + 1.
 */
async function withNestedCollections(
  candidates: Candidate[],
): Promise<Candidate[]> {
  if (candidates.length === 0) return candidates;

  const [documentRows, applicationRows] = await Promise.all([
    fetchAllPages<DocumentResponse>("/documents"),
    fetchAllPages<ApplicationResponse>("/applications"),
  ]);

  const documentsByCandidate = new Map<string, DocumentResponse[]>();
  for (const row of documentRows) {
    if (!row.candidateId) continue;
    const bucket = documentsByCandidate.get(row.candidateId);
    if (bucket) bucket.push(row);
    else documentsByCandidate.set(row.candidateId, [row]);
  }

  const applicationsByCandidate = new Map<string, ApplicationResponse[]>();
  for (const row of applicationRows) {
    const bucket = applicationsByCandidate.get(row.candidateId);
    if (bucket) bucket.push(row);
    else applicationsByCandidate.set(row.candidateId, [row]);
  }

  return candidates.map((candidate) => {
    const documents = (documentsByCandidate.get(candidate.id) ?? []).map(
      (document) => toDocument(document, candidate.id),
    );
    const applications = (applicationsByCandidate.get(candidate.id) ?? []).map(
      toApplication,
    );
    const primary = applications[0];

    return {
      ...candidate,
      documents,
      applications,
      processingStatus: aggregateDocumentStatus(documents),
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
