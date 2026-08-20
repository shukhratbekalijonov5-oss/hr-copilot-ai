"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { FieldErrors } from "@/lib/api/errors";
import {
  clearSessionTokens,
  setAccessToken,
  setSessionTokens,
} from "@/lib/api/session";
import {
  safeReturnToForAccountType,
  defaultRouteForAccountType,
} from "@/lib/auth/routing";
import type { AccountType, LoginInput, RegisterInput } from "@/lib/types";

/**
 * Auth runs as server actions, which is the only place besides Proxy where
 * cookies can be written. Neither the access token nor the refresh token ever
 * passes through browser JavaScript.
 */

export interface AuthActionResult {
  ok: boolean;
  message?: string;
  code?: string | null;
  fieldErrors?: FieldErrors;
}

export async function loginAction(
  input: LoginInput,
  next?: string,
): Promise<AuthActionResult> {
  let pair: Awaited<ReturnType<typeof api.login>>;
  try {
    pair = await api.login(input);
    await setSessionTokens(pair);
  } catch (error) {
    if (error instanceof ApiError) {
      // Never disclose whether the address exists — the backend already
      // returns a single "Invalid credentials" for both cases.
      return {
        ok: false,
        message: error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      };
    }
    return { ok: false, message: "Could not sign in. Try again." };
  }

  // Outside the try: redirect() signals by throwing, and catching it here
  // would swallow the navigation.
  const accountType = pair.user.accountType ?? input.accountType;
  redirect(
    accountType
      ? safeReturnToForAccountType(
          next,
          accountType,
          Boolean(pair.user.organizationId),
        )
      : "/",
  );
}

export async function registerAction(
  input: RegisterInput,
  accountType: AccountType,
): Promise<AuthActionResult> {
  let pair: Awaited<ReturnType<typeof api.registerCandidate>>;
  try {
    pair =
      accountType === "CANDIDATE"
        ? await api.registerCandidate(input)
        : await api.registerOrganization(input);
    await setSessionTokens(pair);
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      };
    }
    return { ok: false, message: "Could not create the account. Try again." };
  }

  redirect(
    defaultRouteForAccountType(accountType, Boolean(pair.user.organizationId)),
  );
}

/**
 * Signs out of THIS device.
 *
 * The backend session is revoked first: dropping the cookies alone would leave
 * a live refresh token that anyone holding a copy could keep rotating. A failed
 * revoke still clears the cookies — the user asked to be signed out here, and
 * the session shows up in "Sign out everywhere" if the call never landed.
 */
export async function logoutAction(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // Already-invalid sessions and a briefly unreachable API both end the same
    // way from the user's point of view.
  }
  await clearSessionTokens();
  redirect("/login");
}

/** Signs out of every device: revokes all sessions, then clears this browser. */
export async function logoutAllAction(): Promise<void> {
  try {
    await api.logoutAll();
  } catch {
    // Same reasoning as logoutAction.
  }
  await clearSessionTokens();
  redirect("/login");
}

export interface SwitchWorkspaceResult {
  ok: boolean;
  message?: string;
}

/**
 * Activates another organization the user belongs to.
 *
 * The backend returns a new access token whose `org` claim names it and leaves
 * the refresh session alone, so only the access cookie is replaced. Every
 * organization-scoped render is then invalidated: the previous workspace's
 * candidate lists and dashboards must not survive the switch in the router
 * cache, even for a frame.
 */
export async function switchOrganizationAction(
  organizationId: string,
): Promise<SwitchWorkspaceResult> {
  try {
    const { accessToken } = await api.switchOrganization(organizationId);
    await setAccessToken(accessToken);
  } catch (error) {
    if (error instanceof ApiError) {
      // 404 here means "you are not a member" — the backend does not confirm
      // whether the organization exists.
      return { ok: false, message: error.message };
    }
    return { ok: false, message: "Could not switch workspace." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Remote sign-out of one of the caller's own sessions. */
export async function revokeSessionAction(
  sessionId: string,
): Promise<SwitchWorkspaceResult> {
  try {
    await api.revokeSession(sessionId);
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not sign out that session." };
  }

  revalidatePath("/settings");
  return { ok: true };
}
