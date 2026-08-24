"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type { FieldErrors } from "@/lib/api/errors";
import type { JobPreferencesInput } from "@/lib/types";

export type SavePreferencesResult =
  | { ok: true; updatedAt: string | null }
  | { ok: false; message: string; fieldErrors: FieldErrors };

export type ClearPreferencesResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Replaces the candidate's whole preference profile.
 *
 * The subject is never named: the API resolves the candidate account from the
 * authenticated session, so this action cannot address anyone else's
 * preferences even if it wanted to.
 *
 * Every candidate→jobs surface reads the same shared intent resolver, so the
 * pages that consume it are revalidated here — Rule N1 is not only about the
 * database, it is about no screen still showing the previous intent.
 */
export async function saveJobPreferencesAction(
  input: JobPreferencesInput,
): Promise<SavePreferencesResult> {
  try {
    const saved = await api.saveJobPreferences(input);
    revalidatePath("/job-preferences");
    revalidatePath("/job-matches");
    revalidatePath("/jobs");
    revalidatePath("/my-profile");
    return { ok: true, updatedAt: saved.updatedAt };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message,
        fieldErrors: error.fieldErrors,
      };
    }
    return {
      ok: false,
      message: "Could not save your preferences. Try again.",
      fieldErrors: {},
    };
  }
}

/**
 * Removes the profile entirely. The candidate returns to having stated
 * nothing — a real state, not an error — and no surface may keep showing what
 * they used to want.
 */
export async function deleteJobPreferencesAction(): Promise<ClearPreferencesResult> {
  try {
    await api.deleteJobPreferences();
    revalidatePath("/job-preferences");
    revalidatePath("/job-matches");
    revalidatePath("/jobs");
    revalidatePath("/my-profile");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not clear your preferences." };
  }
}
