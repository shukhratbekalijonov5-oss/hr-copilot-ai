import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import {
  activeOrganizationWorkspace,
  buildWorkspaceContext,
  personalFromSession,
} from "@/lib/workspace/types";

/**
 * The shell for the two routes both account types share.
 *
 * It sits on the GROUP, not on `/settings`, because `/plans` is in this group
 * too and was rendering without any chrome at all — no header, no navigation,
 * no bottom bar. That was survivable while it was one page nobody linked to;
 * it stopped being survivable the moment Plans became a row in the More menu
 * on both sides, because following that link stranded the reader on a page
 * with no way back.
 */
export default async function SharedAccountLayout({
  children,
}: LayoutProps<"/">) {
  const session = await requireSession();
  const active =
    session.accountType === "CANDIDATE"
      ? personalFromSession(session)
      : activeOrganizationWorkspace(session);

  if (!active) {
    redirect("/workspaces");
  }

  const initialUnreadCount = await api
    .getUnreadNotificationCount()
    .catch(() => 0);

  return (
    <AppShell
      user={session}
      workspace={buildWorkspaceContext(session, active)}
      initialUnreadCount={initialUnreadCount}
    >
      {children}
    </AppShell>
  );
}
