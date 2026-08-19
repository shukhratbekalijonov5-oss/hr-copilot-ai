"use server";

import { revalidatePath } from "next/cache";
import { ApiError, api } from "@/lib/api";
import type { FieldErrors } from "@/lib/api/client";
import type { CreateVacancyInput } from "@/lib/types";

export type CreateVacancyResult =
  | { ok: true; vacancyId: string }
  | { ok: false; message: string; fieldErrors: FieldErrors };

/**
 * Mutations run on the server so the mock store stays authoritative for the
 * pages that render from it. Swapping `api.createVacancy` for a real POST
 * leaves this signature untouched.
 */
export async function createVacancyAction(
  input: CreateVacancyInput,
): Promise<CreateVacancyResult> {
  try {
    const vacancy = await api.createVacancy(input);
    revalidatePath("/vacancies");
    revalidatePath("/dashboard");
    return { ok: true, vacancyId: vacancy.id };
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
}
