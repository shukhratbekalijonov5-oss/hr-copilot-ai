import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import {
  activeOrganizationWorkspace,
  buildWorkspaceContext,
  personalFromSession,
} from "@/lib/workspace/types";

export default async function SettingsLayout({
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
