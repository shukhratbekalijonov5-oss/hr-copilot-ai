"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import type { Organization, User } from "@/lib/types";

interface AppShellProps {
  user: User;
  organization: Organization;
  unreadNotifications: number;
  children: ReactNode;
}

export function AppShell({
  user,
  organization,
  unreadNotifications,
  children,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // The drawer must not survive a route change on mobile.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh">
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">
        <Sidebar />
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-pop">
            <Sidebar
              onNavigate={() => setSidebarOpen(false)}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <Header
          user={user}
          organization={organization}
          unreadNotifications={unreadNotifications}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
