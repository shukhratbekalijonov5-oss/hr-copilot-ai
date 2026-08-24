"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import {
  ChevronDownIcon,
  LogoutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from "@/components/ui/icons";
import { openCommandPalette } from "@/lib/command/palette";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import type { SessionUser } from "@/lib/types";
import type { WorkspaceContext } from "@/lib/workspace/types";
import { useI18n } from "@/lib/i18n/context";
import { LocaleSwitcher } from "@/components/layout/LocaleSwitcher";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { CandidateBreadcrumb } from "@/components/layout/CandidateBreadcrumb";
import { logoutAction } from "@/lib/auth/actions";

interface HeaderProps {
  user: SessionUser;
  workspace: WorkspaceContext;
  initialUnreadCount: number;
  onOpenSidebar: () => void;
}

export function Header({
  user,
  workspace,
  initialUnreadCount,
  onOpenSidebar,
}: HeaderProps) {
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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur-md backdrop-saturate-150 sm:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label={d.nav.openNavigation}
        className="-ml-1 flex size-9 items-center justify-center rounded-[10px] text-ink-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted hover:text-ink lg:hidden"
      >
        <MenuIcon className="size-5" />
      </button>

      {workspace.active.kind === "personal" ? (
        <CandidateBreadcrumb />
      ) : (
        <WorkspaceSwitcher context={workspace} />
      )}

      <div className="ml-auto flex items-center gap-1">
        {/*
          The palette trigger doubles as the product's search affordance. On
          a narrow viewport it collapses to the icon alone — the keyboard hint
          is meaningless on a device with no ⌘ key.
        */}
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={d.palette.open}
          className="flex h-9 items-center gap-2 rounded-[10px] border border-transparent px-2 text-ink-muted transition-colors duration-[var(--motion-fast)] hover:border-line hover:bg-surface-muted hover:text-ink sm:border-line sm:bg-surface-muted/60 sm:pl-2.5 sm:pr-1.5"
        >
          <SearchIcon className="size-4 shrink-0" />
          <span className="hidden text-[13px] sm:block">{d.palette.title}</span>
          <kbd className="hidden rounded-[6px] border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-subtle sm:block">
            ⌘K
          </kbd>
        </button>

        <LocaleSwitcher />

        <ThemeToggle />

        <NotificationBell
          audience={
            workspace.active.kind === "personal" ? "CANDIDATE" : "HR"
          }
          initialUnreadCount={initialUnreadCount}
        />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-1.5 rounded-[10px] border border-transparent py-1 pl-1 pr-1.5 transition-colors duration-[var(--motion-fast)] hover:border-line hover:bg-surface-muted"
          >
            <Avatar name={user.fullName} src={user.avatarUrl} size="sm" />
            <span className="hidden text-[13px] font-medium text-ink sm:block">
              {user.fullName.split(" ")[0]}
            </span>
            <ChevronDownIcon className="size-4 text-ink-subtle" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="animate-pop-in absolute right-0 top-[calc(100%+0.4rem)] w-60 overflow-hidden rounded-[14px] border border-line bg-surface shadow-pop"
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
