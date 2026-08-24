"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import type { SessionUser } from "@/lib/types";
import type { WorkspaceContext } from "@/lib/workspace/types";

interface AppShellProps {
  user: SessionUser;
  workspace: WorkspaceContext;
  initialUnreadCount: number;
  children: ReactNode;
}

export function AppShell({
  user,
  workspace,
  initialUnreadCount,
  children,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Escape closes the mobile drawer; navigation closes it via `onNavigate`.
  useEffect(() => {
    if (!sidebarOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="flex min-h-dvh">
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">
        <Sidebar
          workspace={workspace.active}
          entitlements={workspace.entitlements}
          account={workspace.active.kind === "personal" ? user : null}
        />
      </aside>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="animate-fade-in absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-pop">
            <Sidebar
              workspace={workspace.active}
              entitlements={workspace.entitlements}
              account={workspace.active.kind === "personal" ? user : null}
              onNavigate={() => setSidebarOpen(false)}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <Header
          user={user}
          workspace={workspace}
          initialUnreadCount={initialUnreadCount}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      {/* One palette for the whole app; it derives its commands from the
          active workspace, so each side offers only its own routes. */}
      <CommandPalette workspace={workspace.active} />
    </div>
  );
}
