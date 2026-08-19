import type { Role, SessionUser } from "@/lib/types";

/**
 * Workspaces.
 *
 * A person is one `User`. What they can do depends on which workspace they are
 * currently in — their own job-seeker space, or one of the organizations they
 * belong to. Roles belong to the membership, never to the user, so nothing here
 * reads a "user role" as if it were global.
 *
 * The backend does not model this yet (see the migration notes in README): a
 * User carries a single `organizationId` and `role` column, so today exactly
 * one organization workspace can be derived and the personal workspace has no
 * backing account. The shape below is what the UI needs either way — when
 * `OrganizationMember` lands, `organizations` becomes a list of many instead of
 * a list of one, and no component has to change.
 */

export type WorkspaceKind = "personal" | "organization";

export interface OrganizationWorkspace {
  kind: "organization";
  /** The organization's id. Never sent to the API — the backend derives tenancy. */
  id: string;
  name: string;
  slug: string;
  /** The caller's role *in this organization*. */
  role: Role;
}

export interface PersonalWorkspace {
  kind: "personal";
  id: "personal";
  name: string;
}

export type Workspace = OrganizationWorkspace | PersonalWorkspace;

export interface WorkspaceContext {
  /** Derived from the route the user is on, not from stored state. */
  active: Workspace;
  organizations: OrganizationWorkspace[];
  personal: PersonalWorkspace;
  /**
   * False while the backend has no CandidateAccount. The personal workspace is
   * still listed so the concept is visible, but entering it is disabled rather
   * than leading to a screen that cannot persist anything.
   */
  personalAvailable: boolean;
}

/**
 * Builds the workspace list from the session.
 *
 * Today the session carries one organization, so this returns one. It is
 * written as a list on purpose — that is the only part that changes when
 * multi-organization membership arrives.
 */
export function organizationsFromSession(
  session: SessionUser,
): OrganizationWorkspace[] {
  return [
    {
      kind: "organization",
      id: session.organization.id,
      name: session.organization.name,
      slug: session.organization.slug,
      role: session.role,
    },
  ];
}

export function personalFromSession(session: SessionUser): PersonalWorkspace {
  return { kind: "personal", id: "personal", name: session.fullName };
}
