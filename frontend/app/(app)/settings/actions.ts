"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type { FieldErrors } from "@/lib/api/errors";

export interface SettingsActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
}

function toResult(error: unknown, fallback: string): SettingsActionResult {
  if (error instanceof ApiError) {
    return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
  }
  return { ok: false, message: fallback };
}

export async function updateProfileAction(
  userId: string,
  input: { fullName: string },
): Promise<SettingsActionResult> {
  try {
    await api.updateTeamMember(userId, input);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return toResult(error, "Could not save your profile.");
  }
}

export async function updateOrganizationAction(input: {
  name: string;
}): Promise<SettingsActionResult> {
  try {
    await api.updateOrganization(input);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return toResult(error, "Could not save the organization.");
  }
}
