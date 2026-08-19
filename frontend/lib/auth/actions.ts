"use server";

import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { FieldErrors } from "@/lib/api/errors";
import { clearSessionToken, setSessionToken } from "@/lib/api/session";
import type { LoginInput, RegisterInput } from "@/lib/types";

/**
 * Auth runs as server actions so the backend JWT is written straight into an
 * httpOnly cookie and never passes through browser JavaScript.
 */

export interface AuthActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
}

export async function loginAction(
  input: LoginInput,
): Promise<AuthActionResult> {
  try {
    const { accessToken } = await api.login(input);
    await setSessionToken(accessToken);
  } catch (error) {
    if (error instanceof ApiError) {
      // Never disclose whether the address exists — the backend already
      // returns a single "Invalid credentials" for both cases.
      return {
        ok: false,
        message: error.message,
        fieldErrors: error.fieldErrors,
      };
    }
    return { ok: false, message: "Could not sign in. Try again." };
  }

  // Outside the try: redirect() signals by throwing, and catching it here
  // would swallow the navigation.
  redirect("/dashboard");
}

export async function registerAction(
  input: RegisterInput,
): Promise<AuthActionResult> {
  try {
    const { accessToken } = await api.register(input);
    await setSessionToken(accessToken);
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        message: error.message,
        fieldErrors: error.fieldErrors,
      };
    }
    return { ok: false, message: "Could not create the workspace. Try again." };
  }

  redirect("/dashboard");
}

/**
 * The API issues stateless JWTs and exposes no revocation endpoint, so signing
 * out means dropping the cookie. Documented as a limitation: the token stays
 * technically valid until it expires (backend TOKEN_TTL).
 */
export async function logoutAction(): Promise<void> {
  await clearSessionToken();
  redirect("/login");
}
