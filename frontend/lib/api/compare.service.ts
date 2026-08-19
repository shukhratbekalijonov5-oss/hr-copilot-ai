import "server-only";

import { getVacancy } from "@/lib/api/vacancies.service";
import { getCandidate } from "@/lib/api/candidates.service";
import { getEvidenceMap, runEvidenceMap } from "@/lib/api/ai.service";
import { MAX_COMPARE_CANDIDATES } from "@/lib/constants";
import { ApiError } from "@/lib/api/errors";
import type { Locale } from "@/lib/i18n/locales";
import type { ComparisonResult, ComparisonRow, EvidenceMap } from "@/lib/types";

/**
 * Requirement-by-requirement comparison built from real mapped evidence.
 *
 * It reads each candidate's stored evidence map — the same rows the candidate
 * page shows — so a cell here and a cell there can never disagree. Reading is a
 * plain database call with no LLM in the path, so the table still builds while
 * generation is unavailable.
 *
 * It reports what each candidate's documents support and nothing else: no
 * ranking, no total, no winner, no recommendation.
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
      const [candidate, map] = await Promise.all([
        getCandidate(candidateId),
        getEvidenceMap(candidateId, vacancyId),
      ]);
      return { candidate, map };
    }),
  );

  const rows: ComparisonRow[] = vacancy.requirements.map((requirement) => ({
    requirementId: requirement.id,
    requirementText: requirement.text,
    required: requirement.required,
    cells: perCandidate.map(({ candidate, map }) => {
      const mapping = map.requirements.find(
        (item) => item.requirementId === requirement.id,
      );

      return {
        candidateId: candidate.id,
        // A requirement the map does not mention has not been checked for this
        // candidate, which is NOT_RUN rather than "no evidence found".
        status: mapping?.status ?? "NOT_RUN",
        // One citation per cell keeps the table readable; the candidate page
        // shows every passage behind the same status.
        citation: mapping?.citations[0] ?? null,
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
    unmappedCandidateIds: perCandidate
      .filter(({ map }) => !map.hasRun)
      .map(({ candidate }) => candidate.id),
  };
}

/**
 * Runs the mapping for every candidate that has none, then rebuilds the table.
 *
 * Candidates are mapped one at a time rather than in parallel: each run is a
 * retrieval-heavy backend operation, and firing five at once would queue them
 * behind each other anyway while making a partial failure harder to attribute.
 * A candidate whose run fails keeps its NOT_RUN cells instead of failing the
 * whole comparison.
 */
export async function mapMissingCandidates(
  vacancyId: string,
  candidateIds: string[],
  locale: Locale,
): Promise<ComparisonResult> {
  for (const candidateId of candidateIds) {
    let existing: EvidenceMap;
    try {
      existing = await getEvidenceMap(candidateId, vacancyId);
    } catch {
      continue;
    }
    if (existing.hasRun) continue;

    try {
      await runEvidenceMap(candidateId, vacancyId, locale);
    } catch {
      // Left unmapped; the rebuilt table reports it as NOT_RUN.
    }
  }

  return compareCandidates(vacancyId, candidateIds);
}
