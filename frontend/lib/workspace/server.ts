import "server-only";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { defaultRouteForAccountType } from "@/lib/auth/routing";
import {
  activeOrganizationWorkspace,
  buildWorkspaceContext,
  personalFromSession,
  type WorkspaceContext,
} from "@/lib/workspace/types";
import type { SessionUser } from "@/lib/types";

/**
 * Resolves the workspace context for a request.
 *
 * The active workspace comes from the route the user is on: routes under
 * `(app)` are organization-scoped, routes under `(candidate)` are personal.
 * Which ORGANIZATION is active comes from the backend — the token's `org`
 * claim, re-validated against a live membership on every request — never from
 * anything the frontend remembers.
 */
export { buildWorkspaceContext };

/**
 * For routes inside the recruiting workspace.
 *
 * A user whose token carries no active organization cannot render these pages:
 * every org-scoped backend route answers 403, so sending them to the workspace
 * picker is the honest outcome rather than a page full of errors. A user with
 * exactly one membership is switched into it automatically — being asked to
 * choose from a list of one is friction, not a decision.
 */
export async function requireOrganizationWorkspace(): Promise<{
  session: SessionUser;
  workspace: WorkspaceContext;
}> {
  const session = await requireSession();

  if (session.accountType === "CANDIDATE") {
    redirect(defaultRouteForAccountType("CANDIDATE"));
  }

  const active = activeOrganizationWorkspace(session);

  if (!active) {
    redirect("/workspaces");
  }

  return { session, workspace: buildWorkspaceContext(session, active) };
}

/** For routes inside the personal (job-seeker) workspace. */
export async function requirePersonalWorkspace(): Promise<{
  session: SessionUser;
  workspace: WorkspaceContext;
}> {
  const session = await requireSession();

  if (session.accountType === "ORGANIZATION") {
    redirect(
      defaultRouteForAccountType("ORGANIZATION", Boolean(session.activeOrganization)),
    );
  }

  return {
    session,
    workspace: buildWorkspaceContext(session, personalFromSession(session)),
  };
}
