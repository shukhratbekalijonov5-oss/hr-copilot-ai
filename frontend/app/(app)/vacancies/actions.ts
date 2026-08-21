"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { vacancyAccessReason } from "@/lib/api/vacancy-errors";
import type { VacancyAccessReason } from "@/lib/types";

export type BulkDeleteResult =
  | { ok: true; deletedCount: number }
  | { ok: false; reason: VacancyAccessReason | null };

/**
 * Deletes the selected vacancies in one all-or-nothing call.
 *
 * The backend rejects the WHOLE batch if any id is foreign (404) or was
 * created by a colleague (403) and deletes nothing, so there is no optimistic
 * removal here: the UI refreshes from the server and shows exactly what
 * survived. Deleting also purges each vacancy's applications, evidence and
 * interview conversations, which is why the confirmation says so.
 */
export async function bulkDeleteVacanciesAction(
  vacancyIds: string[],
): Promise<BulkDeleteResult> {
  try {
    const result = await api.bulkDeleteVacancies(vacancyIds);

    revalidatePath("/vacancies");
    revalidatePath("/dashboard");
    revalidatePath("/candidates");
    revalidatePath("/compare");
    revalidatePath("/interview-chats");
    revalidatePath("/processing");

    return { ok: true, deletedCount: result.deletedCount };
  } catch (error) {
    return { ok: false, reason: vacancyAccessReason(error) };
  }
}
