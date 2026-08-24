"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import { vacancyAccessReason } from "@/lib/api/vacancy-errors";
import type { FieldErrors } from "@/lib/api/errors";
import type { UpdateVacancyInput, VacancyAccessReason } from "@/lib/types";

export type UpdateVacancyResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      fieldErrors: FieldErrors;
      /** Set when the API refused on ownership grounds rather than on input. */
      reason: VacancyAccessReason | null;
    };

/**
 * Edits a vacancy the caller created.
 *
 * Ownership is NOT decided here. The backend re-checks that the caller created
 * the vacancy on every PATCH and answers 403 VACANCY_NOT_OWNED otherwise, so
 * hiding the edit link is a courtesy and this is only how that refusal is
 * turned into something the form can show.
 *
 * The lifecycle stage is deliberately absent from the payload: publishing,
 * closing and archiving are separate, deliberate actions, and an edit must not
 * quietly reopen a closed role.
 */
export async function updateVacancyAction(
  vacancyId: string,
  input: UpdateVacancyInput,
): Promise<UpdateVacancyResult> {
  try {
    await api.updateVacancy(vacancyId, input);
  } catch (error) {
    const reason = vacancyAccessReason(error);
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message,
        fieldErrors: error.fieldErrors,
        reason,
      };
    }
    return {
      ok: false,
      message: "Could not save the vacancy. Try again.",
      fieldErrors: {},
      reason,
    };
  }

  revalidatePath(`/vacancies/${vacancyId}`);
  revalidatePath("/vacancies");
  revalidatePath("/dashboard");
  // The candidate-facing posting renders the same structured fields.
  revalidatePath("/jobs");

  return { ok: true };
}
