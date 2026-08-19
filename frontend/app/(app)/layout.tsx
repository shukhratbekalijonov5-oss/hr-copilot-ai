import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await api.getSession();

  return (
    <AppShell
      user={session.user}
      organization={session.organization}
      unreadNotifications={3}
    >
      {children}
    </AppShell>
  );
}
