import "server-only";

import { apiFetch, fetchAllPages } from "@/lib/api/http";
import { buildRequirementEvidence, toEvidence } from "@/lib/api/adapters";
import { getCandidate } from "@/lib/api/candidates.service";
import { getVacancy } from "@/lib/api/vacancies.service";
import type { EvidenceResponse } from "@/lib/api/contracts";
import type { Evidence, RequirementEvidence } from "@/lib/types";

/** Raw passages extracted from a candidate's documents. */
export async function getCandidateEvidence(
  candidateId: string,
  vacancyId?: string,
): Promise<Evidence[]> {
  const rows = await fetchAllPages<EvidenceResponse>(
    `/evidence/by-candidate/${candidateId}`,
    vacancyId ? { vacancyId } : {},
  );
  return rows.map(toEvidence);
}

export async function getRequirementEvidence(
  requirementId: string,
): Promise<Evidence[]> {
  const rows = await fetchAllPages<EvidenceResponse>(
    `/evidence/by-requirement/${requirementId}`,
  );
  return rows.map(toEvidence);
}

/**
 * A vacancy's requirements paired with the passages supporting each one, for a
 * single candidate. Requirements with no passages come back NOT_FOUND.
 */
export async function getCandidateRequirementEvidence(
  candidateId: string,
  vacancyId: string,
): Promise<RequirementEvidence[]> {
  const [vacancy, candidate, evidence] = await Promise.all([
    getVacancy(vacancyId),
    getCandidate(candidateId),
    getCandidateEvidence(candidateId, vacancyId),
  ]);

  const documentNames = new Map(
    candidate.documents.map((document) => [
      document.id,
      document.originalFileName,
    ]),
  );

  return buildRequirementEvidence(
    vacancy.requirements,
    evidence,
    documentNames,
  );
}

export async function countEvidence(): Promise<number> {
  const response = await apiFetch<{ meta: { total: number } }>("/evidence", {
    query: { page: 1, limit: 1 },
  });
  return response.meta.total;
}
