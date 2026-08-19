import { AppShell } from "@/components/layout/AppShell";
import { requireOrganizationWorkspace } from "@/lib/workspace/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  /**
   * The authorization boundary. `proxy.ts` only checks that a cookie exists;
   * this verifies the token against the backend and redirects if it is no
   * longer valid, so every page below is genuinely authenticated.
   */
  const { session, workspace } = await requireOrganizationWorkspace();

  return (
    <AppShell user={session} workspace={workspace}>
      {children}
    </AppShell>
  );
}
