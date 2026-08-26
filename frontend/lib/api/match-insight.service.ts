import { apiFetch } from "@/lib/api/http";
import type {
  CompareInsightsResponse,
  HrMatchInsightResponse,
} from "@/lib/api/contracts";
import { toCompareInsights, toHrMatchInsight } from "@/lib/api/adapters";
import type { CompareInsights, HrMatchInsight } from "@/lib/match/hr-insight";

/**
 * The HR-side advanced match endpoints.
 *
 * Both are POST because both COMPUTE: the assessment ranks one pair against a
 * vacancy's requirements and the comparison assesses several. Neither is a
 * cheap read, and neither is safe to prefetch on hover.
 *
 * The candidate's private preferences never appear in either response — the
 * backend strips stated salary, locations and exclusions before an HR context
 * is built — so there is nothing to filter out here, and nothing here should
 * ever start displaying a field that arrives unexpectedly.
 */

/** POST the full advanced assessment of one applicant against one vacancy. */
export async function getHrMatchInsight(
  candidateId: string,
  vacancyId: string,
  locale?: string,
): Promise<HrMatchInsight> {
  const response = await apiFetch<HrMatchInsightResponse>(
    `/candidates/${candidateId}/vacancies/${vacancyId}/match-insight`,
    { method: "POST", body: locale ? { locale } : {} },
  );

  return toHrMatchInsight(response);
}

/**
 * POST a side-by-side comparison of 2–5 applicants on one vacancy.
 *
 * The superlatives come back decided: which candidate leads each measure is
 * the backend's deterministic answer, pinned to the number that decided it.
 * The frontend renders the winner it is given and never recomputes one, so a
 * tie-break rule can never differ between the two sides.
 */
export async function getCompareInsights(
  vacancyId: string,
  candidateIds: string[],
  locale?: string,
): Promise<CompareInsights> {
  const response = await apiFetch<CompareInsightsResponse>(
    `/vacancies/${vacancyId}/compare-insights`,
    { method: "POST", body: { candidateIds, ...(locale ? { locale } : {}) } },
  );

  return toCompareInsights(response);
}
