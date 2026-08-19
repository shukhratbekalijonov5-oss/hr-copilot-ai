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
import type { Organization, User } from "@/lib/types";
import { USER_ROLE_LABELS } from "@/lib/constants";

interface HeaderProps {
  user: User;
  organization: Organization;
  unreadNotifications: number;
  onOpenSidebar: () => void;
}

export function Header({
  user,
  organization,
  unreadNotifications,
  onOpenSidebar,
}: HeaderProps) {
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
        aria-label="Open navigation"
        className="-ml-1 rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink lg:hidden"
      >
        <MenuIcon className="size-5" />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold text-ink-muted">
          {organization.name.slice(0, 1)}
        </span>
        <span className="truncate text-[13.5px] font-medium text-ink">
          {organization.name}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="relative rounded-md p-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
          aria-label={
            unreadNotifications > 0
              ? `Notifications, ${unreadNotifications} unread`
              : "Notifications"
          }
        >
          <BellIcon className="size-5" />
          {unreadNotifications > 0 ? (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-critical ring-2 ring-[var(--surface)]" />
          ) : null}
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
                  {USER_ROLE_LABELS[user.role]} · {organization.name}
                </p>
              </div>
              <div className="p-1">
                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  <UserIcon className="size-4" />
                  Profile
                </Link>
                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  <SettingsIcon className="size-4" />
                  Workspace settings
                </Link>
                <Link
                  href="/login"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  <LogoutIcon className="size-4" />
                  Sign out
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
