import "server-only";

import { BACKEND_CAPABILITIES } from "@/lib/capabilities";
import { requireSession } from "@/lib/auth/session";
import {
  organizationsFromSession,
  personalFromSession,
  type Workspace,
  type WorkspaceContext,
} from "@/lib/workspace/types";
import type { SessionUser } from "@/lib/types";

/**
 * Resolves the workspace context for a request.
 *
 * The active workspace comes from which route the user is on rather than from
 * stored state — there is only ever one organization to be in today, so a
 * persisted selection would be state pretending to be a choice.
 */
export function buildWorkspaceContext(
  session: SessionUser,
  active: Workspace,
): WorkspaceContext {
  return {
    active,
    organizations: organizationsFromSession(session),
    personal: personalFromSession(session),
    personalAvailable: BACKEND_CAPABILITIES.candidateAccount,
  };
}

/** For routes inside the recruiting workspace. */
export async function requireOrganizationWorkspace(): Promise<{
  session: SessionUser;
  workspace: WorkspaceContext;
}> {
  const session = await requireSession();
  const [organization] = organizationsFromSession(session);
  return { session, workspace: buildWorkspaceContext(session, organization) };
}

/** For routes inside the personal (job-seeker) workspace. */
export async function requirePersonalWorkspace(): Promise<{
  session: SessionUser;
  workspace: WorkspaceContext;
}> {
  const session = await requireSession();
  return {
    session,
    workspace: buildWorkspaceContext(session, personalFromSession(session)),
  };
}
