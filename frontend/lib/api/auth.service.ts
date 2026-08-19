import "server-only";

import { apiFetch } from "@/lib/api/http";
import { toSessionUser } from "@/lib/api/adapters";
import type { AuthTokenResponse, MeResponse } from "@/lib/api/contracts";
import type { LoginInput, RegisterInput, SessionUser } from "@/lib/types";

/** POST /auth/login → { accessToken, user } */
export function login(input: LoginInput): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>("/auth/login", {
    method: "POST",
    body: { email: input.email.trim(), password: input.password },
    // No cookie exists yet, so no bearer token is attached.
    token: null,
  });
}

/** POST /auth/register → creates the organization and its OWNER. */
export function register(input: RegisterInput): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>("/auth/register", {
    method: "POST",
    body: {
      organizationName: input.organizationName.trim(),
      organizationSlug: input.organizationSlug.trim(),
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      password: input.password,
    },
    token: null,
  });
}

/**
 * GET /auth/me — re-reads the user, so a deleted or edited account cannot keep
 * riding an old token. Throws ApiError(401) when the session is no longer good.
 */
export async function getSession(token?: string): Promise<SessionUser> {
  const response = await apiFetch<MeResponse>("/auth/me", {
    token: token ?? undefined,
  });
  return toSessionUser(response);
}
