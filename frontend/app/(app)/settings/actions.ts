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

/*
 * The caller's OWN name, email and picture are not here.
 *
 * They live on the account, not on a membership, so they are edited through
 * the shared `lib/account/actions.ts` — the same actions the candidate profile
 * uses. `api.updateTeamMember` remains for what it is actually for: changing a
 * TEAMMATE's role inside this organization.
 */
export async function updateOrganizationAction(input: {
  name: string;
  /** Empty string clears the address; the backend stores it as null. */
  websiteUrl?: string;
}): Promise<SettingsActionResult> {
  try {
    await api.updateOrganization(input);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return toResult(error, "Could not save the organization.");
  }
}
