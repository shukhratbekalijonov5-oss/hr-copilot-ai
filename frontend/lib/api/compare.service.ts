import "server-only";

import { getVacancy } from "@/lib/api/vacancies.service";
import { getCandidate } from "@/lib/api/candidates.service";
import { getCandidateEvidence } from "@/lib/api/evidence.service";
import { buildRequirementEvidence } from "@/lib/api/adapters";
import { MAX_COMPARE_CANDIDATES } from "@/lib/constants";
import { ApiError } from "@/lib/api/errors";
import type { ComparisonResult, ComparisonRow } from "@/lib/types";

/**
 * Requirement-by-requirement comparison built from real evidence.
 *
 * It reports what each candidate's documents support and nothing else: no
 * ranking, no winner, no recommendation.
 */
export async function compareCandidates(
  vacancyId: string,
  candidateIds: string[],
): Promise<ComparisonResult> {
  if (candidateIds.length > MAX_COMPARE_CANDIDATES) {
    throw new ApiError(
      `Compare up to ${MAX_COMPARE_CANDIDATES} candidates at a time.`,
      400,
      "validation",
    );
  }

  const vacancy = await getVacancy(vacancyId);

  const perCandidate = await Promise.all(
    candidateIds.map(async (candidateId) => {
      const [candidate, evidence] = await Promise.all([
        getCandidate(candidateId),
        getCandidateEvidence(candidateId, vacancyId),
      ]);

      const documentNames = new Map(
        candidate.documents.map((document) => [
          document.id,
          document.originalFileName,
        ]),
      );

      return {
        candidate,
        rows: buildRequirementEvidence(
          vacancy.requirements,
          evidence,
          documentNames,
        ),
      };
    }),
  );

  const rows: ComparisonRow[] = vacancy.requirements.map((requirement) => ({
    requirementId: requirement.id,
    requirementText: requirement.text,
    required: requirement.required,
    cells: perCandidate.map(({ candidate, rows: requirementRows }) => {
      const match = requirementRows.find(
        (row) => row.requirementId === requirement.id,
      );
      return {
        candidateId: candidate.id,
        status: match?.status ?? "NOT_FOUND",
        citation: match?.citations[0] ?? null,
      };
    }),
  }));

  return {
    vacancyId,
    vacancyTitle: vacancy.title,
    candidates: perCandidate.map(({ candidate }) => ({
      id: candidate.id,
      fullName: candidate.fullName,
      currentTitle: candidate.currentTitle,
      totalExperienceYears: candidate.totalExperienceYears,
      location: candidate.location,
    })),
    rows,
  };
}
