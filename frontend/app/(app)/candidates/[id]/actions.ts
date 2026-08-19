"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type { ApplicationStatus } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Moves an application to another stage.
 *
 * This is the only place a candidate's standing changes, and it always
 * originates from a person clicking a control. Nothing in the product advances
 * or rejects an application on its own.
 */
export async function setApplicationStatusAction(
  applicationId: string,
  candidateId: string,
  status: ApplicationStatus,
): Promise<ActionResult> {
  try {
    await api.setApplicationStatus(applicationId, status);
    revalidatePath(`/candidates/${candidateId}`);
    revalidatePath("/candidates");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not update the application." };
  }
}
