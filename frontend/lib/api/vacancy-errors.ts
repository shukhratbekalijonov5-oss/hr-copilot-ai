import { ApiError } from "@/lib/api/errors";
import type { VacancyAccessReason } from "@/lib/types";

/**
 * Turns a refused vacancy-scoped operation into a reason the UI has words for.
 *
 * The backend's disclosure semantics are deliberately asymmetric and are
 * preserved here rather than flattened:
 *
 *   403 VACANCY_NOT_OWNED          — a colleague's vacancy in the same org.
 *                                    Visible in the catalog, not yours to work
 *                                    inside; saying so leaks nothing.
 *   403 CANDIDATE_NOT_IN_VACANCY   — the candidate is not in this pipeline.
 *   409 CANDIDATE_ALREADY_IN_VACANCY — duplicate association.
 *   404                            — foreign-org or unknown vacancy. Existence
 *                                    is never confirmed across tenants, so this
 *                                    must stay "not found", never "not yours".
 *
 * Returns null when the failure is something else entirely (network, 500,
 * auth), which the caller reports through its existing error path.
 */
export function vacancyAccessReason(error: unknown): VacancyAccessReason | null {
  if (!(error instanceof ApiError)) return null;

  switch (error.code) {
    case "VACANCY_NOT_OWNED":
      return "not_owned";
    case "CANDIDATE_NOT_IN_VACANCY":
      return "candidate_not_in_vacancy";
    case "CANDIDATE_ALREADY_IN_VACANCY":
      return "candidate_already_in_vacancy";
  }

  // Codeless fallbacks: the status still carries the meaning.
  if (error.kind === "not_found") return "vacancy_not_found";
  if (error.kind === "conflict") return "candidate_already_in_vacancy";
  return null;
}

/** True when the selected vacancy is unusable and the selection must reset. */
export function isVacancySelectionInvalid(error: unknown): boolean {
  const reason = vacancyAccessReason(error);
  return reason === "not_owned" || reason === "vacancy_not_found";
}
