import "server-only";

import { apiFetch } from "@/lib/api/http";
import { toAuthSession, toSessionUser } from "@/lib/api/adapters";
import type {
  AuthSessionResponse,
  AuthSessionRowResponse,
  MeResponse,
  SwitchOrganizationResponse,
} from "@/lib/api/contracts";
import type { TokenPair } from "@/lib/auth/refresh";
import type {
  ActiveOrganization,
  AuthSessionRow,
  LoginInput,
  RegisterInput,
  SessionUser,
} from "@/lib/types";

/** POST /auth/login → an access token, a refresh token and the user. */
export function login(input: LoginInput): Promise<TokenPair> {
  return apiFetch<AuthSessionResponse>("/auth/login", {
    method: "POST",
    body: {
      email: input.email.trim(),
      password: input.password,
      deviceName: input.deviceName,
    },
    // No cookie exists yet, so no bearer token is attached.
    token: null,
  });
}

/**
 * POST /auth/register.
 *
 * Organization fields are sent only when both are present: the backend rejects
 * a half-filled pair, and omitting both is what registers a job seeker.
 */
export function register(input: RegisterInput): Promise<TokenPair> {
  const wantsOrganization = Boolean(
    input.organizationName?.trim() && input.organizationSlug?.trim(),
  );

  return apiFetch<AuthSessionResponse>("/auth/register", {
    method: "POST",
    body: {
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      password: input.password,
      preferredLocale: input.preferredLocale,
      deviceName: input.deviceName,
      ...(wantsOrganization
        ? {
            organizationName: input.organizationName!.trim(),
            organizationSlug: input.organizationSlug!.trim(),
          }
        : {}),
    },
    token: null,
  });
}

/**
 * GET /auth/me — re-reads the identity, so a deleted account, a revoked
 * membership or a changed role is reflected on the next request even with an
 * unexpired token. Throws ApiError(401) when the session is no longer good.
 */
export async function getSession(token?: string): Promise<SessionUser> {
  const response = await apiFetch<MeResponse>("/auth/me", {
    token: token ?? undefined,
  });
  return toSessionUser(response);
}

/**
 * POST /auth/switch-organization.
 *
 * Returns a NEW access token whose `org` claim names the chosen organization.
 * The refresh session is deliberately untouched by the backend — the workspace
 * is per-device context, persisted on the session so later refreshes keep
 * minting tokens for it.
 */
export function switchOrganization(organizationId: string): Promise<{
  accessToken: string;
  activeOrganization: ActiveOrganization;
}> {
  return apiFetch<SwitchOrganizationResponse>("/auth/switch-organization", {
    method: "POST",
    body: { organizationId },
  }).then((response) => ({
    accessToken: response.accessToken,
    activeOrganization: response.activeOrganization,
  }));
}

/** POST /auth/logout — revokes THIS session server-side. */
export function logout(): Promise<{ loggedOut: boolean }> {
  return apiFetch<{ loggedOut: boolean }>("/auth/logout", { method: "POST" });
}

/** POST /auth/logout-all — revokes every session of the caller. */
export function logoutAll(): Promise<{
  loggedOut: boolean;
  revokedSessions: number;
}> {
  return apiFetch("/auth/logout-all", { method: "POST" });
}

/** GET /auth/sessions — the caller's own live sessions. */
export async function listSessions(): Promise<AuthSessionRow[]> {
  const rows = await apiFetch<AuthSessionRowResponse[]>("/auth/sessions");
  return rows.map(toAuthSession);
}

/** DELETE /auth/sessions/:id — remote sign-out of one own session. */
export function revokeSession(id: string): Promise<{ revoked: boolean }> {
  return apiFetch(`/auth/sessions/${id}`, { method: "DELETE" });
}
