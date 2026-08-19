import { ApiError, mockRequest } from "@/lib/api/client";
import { buildEvidence, findCandidate, findVacancy } from "@/lib/mock/store";
import { MAX_COMPARE_CANDIDATES } from "@/lib/constants";
import type { ComparisonResult, ComparisonRow } from "@/lib/types";

export async function compareCandidates(
  vacancyId: string,
  candidateIds: string[],
): Promise<ComparisonResult> {
  return mockRequest(() => {
    const vacancy = findVacancy(vacancyId);
    if (!vacancy) {
      throw new ApiError(`Vacancy ${vacancyId} was not found.`, 404);
    }
    if (candidateIds.length > MAX_COMPARE_CANDIDATES) {
      throw new ApiError(
        `Compare up to ${MAX_COMPARE_CANDIDATES} candidates at a time.`,
        422,
      );
    }

    const selected = candidateIds
      .map((id) => findCandidate(id))
      .filter((candidate) => candidate !== null);

    const evidenceByCandidate = new Map(
      selected.map((candidate) => [
        candidate.id,
        buildEvidence(candidate.id, vacancyId),
      ]),
    );

    const rows: ComparisonRow[] = vacancy.requirements.map((requirement) => ({
      requirementId: requirement.id,
      requirementLabel: requirement.label,
      requirementKind: requirement.kind,
      cells: selected.map((candidate) => {
        const evidence = evidenceByCandidate
          .get(candidate.id)
          ?.find((item) => item.requirementId === requirement.id);

        return {
          candidateId: candidate.id,
          status: evidence?.status ?? "not_found",
          citation: evidence?.citations[0] ?? null,
        };
      }),
    }));

    return {
      vacancyId,
      vacancyTitle: vacancy.title,
      candidates: selected.map((candidate) => ({
        id: candidate.id,
        fullName: candidate.fullName,
        currentTitle: candidate.currentTitle,
        yearsOfExperience: candidate.yearsOfExperience,
        location: candidate.location,
      })),
      rows,
    };
  }, 520);
}
