import type { Role, SessionUser } from "@/lib/types";

/**
 * Workspaces.
 *
 * A person is one `User`. What they can do depends on which workspace they are
 * currently in — their own job-seeker space, or one of the organizations they
 * belong to. Roles belong to the membership, never to the user, so nothing here
 * reads a "user role" as if it were global.
 *
 * The identity migration made this literal: `GET /auth/me` returns a
 * `memberships[]` array and an `activeOrganization`, and one user can hold
 * several memberships with a different role in each. The personal workspace is
 * independent of all of them — a recruiter at two organizations may also be a
 * job seeker, and the two sides must not borrow each other's assumptions.
 */

export type WorkspaceKind = "personal" | "organization";

export interface OrganizationWorkspace {
  kind: "organization";
  /** The organization's id. Sent only to /auth/switch-organization. */
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
  /** Derived from the route the user is on and the token's active org. */
  active: Workspace;
  /** Every organization the user actually belongs to. */
  organizations: OrganizationWorkspace[];
  personal: PersonalWorkspace;
  /**
   * The organization the current access token points at, if any.
   *
   * Null for a job seeker, and also when the token's claim is stale because
   * the membership was revoked. Both mean the same thing to the UI: do not
   * render organization data, offer the picker.
   */
  activeOrganizationId: string | null;
  /**
   * Whether the user has created their job-seeker profile yet.
   *
   * The workspace is reachable either way — the profile page creates the
   * account — but the switcher says which state it is in rather than implying
   * a profile exists.
   */
  hasCandidateAccount: boolean;
}

/**
 * The organizations the user belongs to, in join order.
 *
 * Built from real membership rows, so a user with none gets an empty list and
 * a user with four gets four — each with the role held in that organization.
 */
export function organizationsFromSession(
  session: SessionUser,
): OrganizationWorkspace[] {
  return session.memberships.map((membership) => ({
    kind: "organization",
    id: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    role: membership.role,
  }));
}

export function personalFromSession(session: SessionUser): PersonalWorkspace {
  return { kind: "personal", id: "personal", name: session.fullName };
}

/**
 * Assembles the context a shell needs.
 *
 * Pure on purpose: it takes a session and the active workspace and derives
 * nothing from request state, so both the server helpers and the tests use the
 * same function.
 */
export function buildWorkspaceContext(
  session: SessionUser,
  active: Workspace,
): WorkspaceContext {
  return {
    active,
    organizations: organizationsFromSession(session),
    personal: personalFromSession(session),
    activeOrganizationId: session.activeOrganization?.id ?? null,
    hasCandidateAccount: session.hasCandidateAccount,
  };
}

/** The workspace matching the token's active organization, if it still exists. */
export function activeOrganizationWorkspace(
  session: SessionUser,
): OrganizationWorkspace | null {
  const active = session.activeOrganization;
  if (!active) return null;
  return {
    kind: "organization",
    id: active.id,
    name: active.name,
    slug: active.slug,
    role: active.role,
  };
}
