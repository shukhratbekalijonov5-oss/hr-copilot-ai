"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type { AccountProfile, AccountProfileInput } from "@/lib/types";

/**
 * The caller's own profile, for BOTH workspaces.
 *
 * Shared rather than duplicated per screen: HR settings and the candidate
 * profile edit the same account through the same endpoint, and two copies
 * would drift the moment one of them gained a rule.
 *
 * Uploads are NOT here — a Server Action body is capped at 1 MB, so the avatar
 * POST goes through `app/api/account/avatar/route.ts`. Everything below is
 * JSON, which is exactly what a Server Action is good at.
 */
export interface AccountActionResult {
  ok: boolean;
  data?: AccountProfile;
  /** The backend's stable code, so the UI can localize the reason. */
  code?: string | null;
  message?: string;
}

/**
 * Both workspaces are revalidated, not just the caller's current one.
 *
 * The name and picture are rendered by the app shell (header, workspace
 * switcher) on every screen, and a dual-identity user can be looking at either
 * side. Revalidating the layout is what makes a saved change appear
 * immediately instead of after a manual reload.
 */
function refreshShell(): void {
  revalidatePath("/", "layout");
}

function toFailure(error: unknown): AccountActionResult {
  if (error instanceof ApiError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: null };
}

export async function updateAccountProfileAction(
  input: AccountProfileInput,
): Promise<AccountActionResult> {
  try {
    const data = await api.updateAccountProfile(input);
    refreshShell();
    return { ok: true, data };
  } catch (error) {
    return toFailure(error);
  }
}

/** Clears the picture. The account, its files and its history are untouched. */
export async function deleteAvatarAction(): Promise<AccountActionResult> {
  try {
    const data = await api.deleteAvatar();
    refreshShell();
    return { ok: true, data };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Called by the client after the upload route handler returns, so the newly
 * stored picture reaches every server-rendered surface without a full reload.
 * The upload itself already happened — this only re-renders.
 */
export async function refreshAfterAvatarUploadAction(): Promise<void> {
  refreshShell();
}
