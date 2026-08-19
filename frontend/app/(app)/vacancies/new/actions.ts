"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type { FieldErrors } from "@/lib/api/errors";
import type { CreateVacancyInput, JobRequirementInput } from "@/lib/types";

export type CreateVacancyResult =
  | { ok: true; vacancyId: string; requirementFailures: number }
  | { ok: false; message: string; fieldErrors: FieldErrors };

/**
 * Creates a vacancy and its requirements.
 *
 * The API models requirements as a child collection with their own endpoint, so
 * this is a create followed by N adds. The vacancy is kept even if a
 * requirement fails — the count of failures is reported rather than silently
 * dropped, and the user can add the rest from the detail page.
 */
export async function createVacancyAction(
  vacancy: CreateVacancyInput,
  requirements: JobRequirementInput[],
): Promise<CreateVacancyResult> {
  let vacancyId: string;

  try {
    const created = await api.createVacancy(vacancy);
    vacancyId = created.id;
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    }
    return {
      ok: false,
      message: "Could not create the vacancy. Try again.",
      fieldErrors: {},
    };
  }

  let requirementFailures = 0;
  for (const requirement of requirements) {
    try {
      await api.addRequirement(vacancyId, requirement);
    } catch {
      requirementFailures += 1;
    }
  }

  revalidatePath("/vacancies");
  revalidatePath("/dashboard");

  return { ok: true, vacancyId, requirementFailures };
}
