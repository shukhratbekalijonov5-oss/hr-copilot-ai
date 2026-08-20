"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import {
  BellIcon,
  ChevronDownIcon,
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/icons";
import type { SessionUser } from "@/lib/types";
import type { WorkspaceContext } from "@/lib/workspace/types";
import { useI18n } from "@/lib/i18n/context";
import { LocaleSwitcher } from "@/components/layout/LocaleSwitcher";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { logoutAction } from "@/lib/auth/actions";

interface HeaderProps {
  user: SessionUser;
  workspace: WorkspaceContext;
  onOpenSidebar: () => void;
}

export function Header({ user, workspace, onOpenSidebar }: HeaderProps) {
  const { d } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-sm sm:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label={d.nav.openNavigation}
        className="-ml-1 rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink lg:hidden"
      >
        <MenuIcon className="size-5" />
      </button>

      <WorkspaceSwitcher context={workspace} />

      <div className="ml-auto flex items-center gap-1">
        <LocaleSwitcher />

        {/* Notifications have no backing endpoint yet, so the control is
            present but explicitly inert rather than showing an invented count. */}
        <button
          type="button"
          disabled
          className="relative rounded-md p-2 text-ink-subtle disabled:cursor-not-allowed"
          aria-label={`${d.nav.notifications} — ${d.nav.notificationsUnavailable}`}
          title={d.nav.notificationsUnavailable}
        >
          <BellIcon className="size-5" />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 hover:bg-surface-muted"
          >
            <Avatar name={user.fullName} size="sm" />
            <span className="hidden text-[13px] font-medium text-ink sm:block">
              {user.fullName.split(" ")[0]}
            </span>
            <ChevronDownIcon className="size-4 text-ink-subtle" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+0.4rem)] w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
            >
              <div className="border-b border-line px-3 py-2.5">
                <p className="truncate text-[13px] font-semibold text-ink">
                  {user.fullName}
                </p>
                <p className="truncate text-[12px] text-ink-muted">{user.email}</p>
                <p className="mt-1 text-[11.5px] text-ink-subtle">
                  {workspace.active.kind === "organization"
                    ? `${d.status.role[workspace.active.role]} · ${workspace.active.name}`
                    : d.nav.personal}
                </p>
              </div>
              <div className="p-1">
                <Link
                  href={
                    user.accountType === "CANDIDATE" ? "/my-profile" : "/settings"
                  }
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  <UserIcon className="size-4" />
                  {d.nav.profile}
                </Link>
                {user.accountType === "ORGANIZATION" ? (
                  <Link
                    href="/settings"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
                  >
                    <SettingsIcon className="size-4" />
                    {d.nav.workspaceSettings}
                  </Link>
                ) : null}
                <form action={logoutAction}>
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
                  >
                    <LogoutIcon className="size-4" />
                    {d.nav.signOut}
                  </button>
                </form>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
