import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import { usePagedQuery } from "@/lib/query/pagination";
import type {
  CandidateSummaryRow,
  ComparisonResult,
  ComparisonRow,
  EvidenceMap,
  Paginated,
  SearchEvidenceHit,
  VacancyDetail,
} from "@/types";

/**
 * The recruiting side's reads, all of them vacancy-scoped.
 *
 * ## Vacancy context is a parameter, never an ambient default
 *
 * Every screen that shows a candidate carries the vacancy it is showing them
 * *for*. That is not a UI convenience: evidence, interview questions and the
 * comparison table are all defined per (candidate, vacancy) pair, and a
 * screen that forgot the vacancy would be showing one vacancy's evidence
 * under another vacancy's heading. The backend refuses the mismatch, so the
 * failure mode is a 403 rather than a leak — but the parameter is explicit
 * here so it cannot be dropped by accident in the first place.
 */
/**
 * The organization's applicants, optionally narrowed to one vacancy.
 *
 * ## Two routes, because the backend has two
 *
 * `/candidates` does NOT accept a `vacancyId` — sending one is a 400, since
 * the API runs `forbidNonWhitelisted`. The vacancy-scoped list is a separate
 * route, `/vacancies/:id/candidates`, and it independently enforces
 * ownership: a vacancy a colleague created answers `VACANCY_NOT_OWNED`
 * rather than quietly returning their applicants. Selecting a vacancy
 * therefore CHANGES THE ROUTE here rather than adding a filter.
 */
export function useOrgCandidates(vacancyId: string | null) {
  return usePagedQuery<CandidateSummaryRow>(
    queryKeys.recruiter.candidates(vacancyId, 0),
    vacancyId ? `/vacancies/${vacancyId}/candidates` : "/candidates",
    { enabled: true },
  );
}

export function useOrgCandidate(id: string | null) {
  return useQuery({
    queryKey: queryKeys.recruiter.candidate(id ?? ""),
    queryFn: () => apiFetch<CandidateSummaryRow>(`/candidates/${id}`),
    enabled: Boolean(id),
  });
}

export function useVacancyDetail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.recruiter.vacancy(id ?? ""),
    queryFn: () => apiFetch<VacancyDetail>(`/vacancies/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * The applicants on one vacancy — the eligible set for compare.
 *
 * Same route as the scoped list above, kept separate because compare needs
 * the whole eligible set in one read to build its picker, not a page of it.
 * `VACANCY_NOT_OWNED` still applies, which is why the picker upstream offers
 * owned vacancies only.
 */
export function useVacancyCandidates(vacancyId: string | null) {
  return useQuery({
    queryKey: ["recruiter", "vacancyCandidates", vacancyId] as const,
    queryFn: () =>
      apiFetch<Paginated<CandidateSummaryRow>>(
        `/vacancies/${vacancyId}/candidates`,
        { query: { page: 1, limit: 50 } },
      ),
    enabled: Boolean(vacancyId),
  });
}

/**
 * The stored evidence map for one (candidate, vacancy) pair.
 *
 * Reading is a plain database call with no model in the path, so the screen
 * still renders while generation is unavailable. `hasRun: false` means it has
 * never been generated — which is a different fact from "generated and found
 * nothing", and the UI must say so rather than showing empty gaps.
 */
export function useEvidenceMap(candidateId: string | null, vacancyId: string | null) {
  return useQuery({
    queryKey: ["recruiter", "evidenceMap", candidateId, vacancyId] as const,
    queryFn: () =>
      apiFetch<EvidenceMap>(
        `/candidates/${candidateId}/vacancies/${vacancyId}/evidence-map`,
      ),
    enabled: Boolean(candidateId && vacancyId),
  });
}

export function useRunEvidenceMap() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({
      candidateId,
      vacancyId,
      locale,
    }: {
      candidateId: string;
      vacancyId: string;
      locale: string;
    }) =>
      apiFetch<EvidenceMap>(
        `/candidates/${candidateId}/vacancies/${vacancyId}/evidence-map`,
        { method: "POST", body: { locale } },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["recruiter", "evidenceMap"] });
      void client.invalidateQueries({ queryKey: ["recruiter", "compare"] });
    },
  });
}

/** An AI summary of one candidate against one vacancy. Generated on demand. */
export function useCandidateSummary() {
  return useMutation({
    mutationFn: ({
      candidateId,
      vacancyId,
      locale,
    }: {
      candidateId: string;
      vacancyId: string;
      locale: string;
    }) =>
      apiFetch<{ summary: string; citations?: unknown[] }>(
        `/search/candidates/${candidateId}/summary`,
        { method: "POST", body: { vacancyId, locale } },
      ),
  });
}

export function useInterviewQuestions() {
  return useMutation({
    mutationFn: ({
      candidateId,
      vacancyId,
      locale,
    }: {
      candidateId: string;
      vacancyId: string;
      locale: string;
    }) =>
      apiFetch<{ questions: { question: string; rationale?: string | null }[] }>(
        `/search/candidates/${candidateId}/vacancies/${vacancyId}/interview-questions`,
        { method: "POST", body: { locale } },
      ),
  });
}

/**
 * Internal AI search across the organization's own applicants' evidence.
 *
 * A mutation, not a query: it is a question the recruiter asks by pressing a
 * button, and a query would re-run it on every remount and every window
 * refocus — spending a retrieval pass each time to answer a question nobody
 * asked twice.
 */
export function useEvidenceSearch() {
  return useMutation({
    mutationFn: ({ query, vacancyId }: { query: string; vacancyId?: string | null }) =>
      apiFetch<{ hits: SearchEvidenceHit[] }>("/search/evidence", {
        method: "POST",
        body: { query, vacancyId: vacancyId ?? undefined, limit: 20 },
      }),
  });
}

/** Grounded answer with validated citations. */
export function useAiAnswer() {
  return useMutation({
    mutationFn: ({
      question,
      vacancyId,
      locale,
    }: {
      question: string;
      vacancyId?: string | null;
      locale: string;
    }) =>
      apiFetch<{ answer: string; citations?: unknown[] }>("/ai/answer", {
        method: "POST",
        body: { question, vacancyId: vacancyId ?? undefined, locale },
      }),
  });
}

/* ------------------------------------------------------------------ */
/* Compare                                                             */
/* ------------------------------------------------------------------ */

/** The ceiling the web client uses. More columns than this is unreadable. */
export const MAX_COMPARE_CANDIDATES = 4;

/**
 * Builds the comparison from stored evidence — no compare endpoint exists.
 *
 * This is composition, not invention: the vacancy supplies the requirement
 * rows, and each candidate's stored evidence map supplies that candidate's
 * cell. Those are the SAME rows the candidate detail screen shows, so a cell
 * here can never disagree with the page it came from.
 *
 * It reports what each candidate's own documents support and nothing else.
 * There is no total, no ranking, no percentage and no recommendation — the
 * statuses are categorical because the underlying judgement is categorical,
 * and turning STRONG/PARTIAL/GAP into a number would manufacture a precision
 * the evidence does not carry.
 */
export function buildComparison(
  vacancy: VacancyDetail,
  entries: { candidate: CandidateSummaryRow; map: EvidenceMap }[],
): ComparisonResult {
  const rows: ComparisonRow[] = vacancy.requirements.map((requirement) => ({
    requirementId: requirement.id,
    requirementText: requirement.text,
    required: requirement.required,
    cells: entries.map(({ candidate, map }) => {
      const mapping = map.requirements.find(
        (item) => item.requirementId === requirement.id,
      );

      return {
        candidateId: candidate.id,
        // A requirement the map does not mention has not been CHECKED for
        // this candidate — NOT_RUN, never "no evidence found".
        status: mapping?.status ?? "NOT_RUN",
        citation: mapping?.citations[0] ?? null,
      };
    }),
  }));

  return {
    vacancyId: vacancy.id,
    vacancyTitle: vacancy.title,
    candidates: entries.map((entry) => entry.candidate),
    rows,
    unmappedCandidateIds: entries
      .filter((entry) => !entry.map.hasRun)
      .map((entry) => entry.candidate.id),
  };
}

export function useComparison(vacancyId: string | null, candidateIds: string[]) {
  const enabled =
    Boolean(vacancyId) &&
    candidateIds.length > 0 &&
    candidateIds.length <= MAX_COMPARE_CANDIDATES;

  return useQuery({
    queryKey: ["recruiter", "compare", vacancyId, [...candidateIds].sort()] as const,
    enabled,
    queryFn: async (): Promise<ComparisonResult> => {
      const vacancy = await apiFetch<VacancyDetail>(`/vacancies/${vacancyId}`);

      const entries = await Promise.all(
        candidateIds.map(async (candidateId) => {
          const [candidate, map] = await Promise.all([
            apiFetch<CandidateSummaryRow>(`/candidates/${candidateId}`),
            apiFetch<EvidenceMap>(
              `/candidates/${candidateId}/vacancies/${vacancyId}/evidence-map`,
            ),
          ]);
          return { candidate, map };
        }),
      );

      return buildComparison(vacancy, entries);
    },
  });
}
