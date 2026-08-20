import "server-only";

import { apiFetch, fetchAllPages } from "@/lib/api/http";
import { toOrganization, toTeamMember } from "@/lib/api/adapters";
import { getSession, listSessions } from "@/lib/api/auth.service";
import type {
  OrganizationResponse,
  UserResponse,
} from "@/lib/api/contracts";
import type { Organization, SettingsData, TeamMember } from "@/lib/types";

export async function getSettings(): Promise<SettingsData> {
  const [user, organization, team, sessions] = await Promise.all([
    getSession(),
    apiFetch<OrganizationResponse>("/organizations/current"),
    fetchAllPages<UserResponse>("/users"),
    // A failed session read must not blank the whole settings page; the
    // security card reports the gap on its own.
    listSessions().catch(() => []),
  ]);

  return {
    user,
    organization: toOrganization(organization),
    team: team.map(toTeamMember),
    sessions,
  };
}

/**
 * PATCH /organizations/current. The API takes the organization from the JWT,
 * so there is no id to pass — and no way for a client to name another tenant.
 */
export async function updateOrganization(input: {
  name?: string;
  slug?: string;
}): Promise<Organization> {
  return toOrganization(
    await apiFetch<OrganizationResponse>("/organizations/current", {
      method: "PATCH",
      body: input,
    }),
  );
}

/** PATCH /users/:id — the only profile mutation the API exposes. */
export async function updateTeamMember(
  id: string,
  input: { fullName?: string; role?: TeamMember["role"] },
): Promise<TeamMember> {
  return toTeamMember(
    await apiFetch<UserResponse>(`/users/${id}`, {
      method: "PATCH",
      body: input,
    }),
  );
}

/** POST /auth/users — creates a teammate inside the caller's organization. */
export async function inviteUser(input: {
  fullName: string;
  email: string;
  password: string;
  role: TeamMember["role"];
}): Promise<TeamMember> {
  return toTeamMember(
    await apiFetch<UserResponse>("/auth/users", {
      method: "POST",
      body: input,
    }),
  );
}
