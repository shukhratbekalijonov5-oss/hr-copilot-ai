import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";
import { requireOrganizationWorkspace } from "@/lib/workspace/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  /**
   * The authorization boundary. `proxy.ts` only checks that a cookie exists;
   * this verifies the token against the backend and redirects if it is no
   * longer valid, so every page below is genuinely authenticated.
   */
  const { session, workspace } = await requireOrganizationWorkspace();
  const initialUnreadCount = await api
    .getUnreadNotificationCount()
    .catch(() => 0);

  return (
    <AppShell
      user={session}
      workspace={workspace}
      initialUnreadCount={initialUnreadCount}
    >
      {children}
    </AppShell>
  );
}
