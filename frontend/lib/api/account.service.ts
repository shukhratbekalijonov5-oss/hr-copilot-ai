import "server-only";

import { apiFetch } from "@/lib/api/http";
import { toAccountProfile } from "@/lib/api/adapters";
import type { AccountProfileResponse } from "@/lib/api/contracts";
import type { AccountProfile, AccountProfileInput } from "@/lib/types";

/**
 * The signed-in person's own account — name, sign-in address, picture.
 *
 * Every route is `/account/me...`, with no id anywhere: the subject is always
 * the caller. It is deliberately shared by both workspaces — a recruiter and a
 * job seeker edit the same three fields on the same account — so there is one
 * client here rather than a recruiter copy and a candidate copy.
 */

/** GET /account/me. */
export function getAccountProfile(): Promise<AccountProfile> {
  return apiFetch<AccountProfileResponse>("/account/me").then(toAccountProfile);
}

/**
 * PATCH /account/me.
 *
 * Send only what changed. Both fields are required when present — the backend
 * rejects a blank name or address, and answers 409 EMAIL_ALREADY_IN_USE when
 * the new address belongs to somebody else.
 */
export function updateAccountProfile(
  input: AccountProfileInput,
): Promise<AccountProfile> {
  return apiFetch<AccountProfileResponse>("/account/me", {
    method: "PATCH",
    body: input,
  }).then(toAccountProfile);
}

/**
 * DELETE /account/me/avatar — clears the picture, keeps the account.
 *
 * The upload half is NOT here: it carries bytes, so it goes through the route
 * handler at `app/api/account/avatar/route.ts` for the same reason candidate
 * document uploads do (a Server Action body is capped at 1 MB).
 */
export function deleteAvatar(): Promise<AccountProfile> {
  return apiFetch<AccountProfileResponse>("/account/me/avatar", {
    method: "DELETE",
  }).then(toAccountProfile);
}
