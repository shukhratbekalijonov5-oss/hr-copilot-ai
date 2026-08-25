"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import {
  ChevronDownIcon,
  LogoutIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  UserIcon,
} from "@/components/ui/icons";
import { openCommandPalette } from "@/lib/command/palette";
import { pageTitleFor } from "@/lib/workspace/primary-nav";
import { usePathname } from "next/navigation";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import type { SessionUser } from "@/lib/types";
import type { WorkspaceContext } from "@/lib/workspace/types";
import { useI18n } from "@/lib/i18n/context";
import { LocaleSwitcher } from "@/components/layout/LocaleSwitcher";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { TopNav } from "@/components/layout/TopNav";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { logoutAction } from "@/lib/auth/actions";

interface HeaderProps {
  user: SessionUser;
  workspace: WorkspaceContext;
  initialUnreadCount: number;
}

/**
 * The application's only chrome.
 *
 * ## It carries navigation now, and that changed its job
 *
 * With the rail gone this bar is where the product's structure lives: brand,
 * the five areas, and the utilities that must stay reachable from every page.
 * The split is deliberate — `TopNav` is *pages*, the right cluster is
 * *tools*. Search, language, theme, notifications and the account menu are
 * not places, they act on wherever the reader already is, so folding them
 * into "More" would hide them behind a menu they would then have to reopen.
 *
 * ## Sticky, and cheap about it
 *
 * `sticky` with a single translucent background and one border. The blur is
 * `md`, not `xl`: a heavy backdrop filter on an element that repaints on
 * every scroll frame is the most reliable way to make a fast page feel slow,
 * and at 72px tall nobody is admiring the frosting.
 *
 * ## Below `lg` this is a title bar again
 *
 * The mobile bottom bar is the navigation there, so the top of a phone screen
 * is better spent naming the current page than repeating five areas the
 * reader can already reach with a thumb.
 */
export function Header({
  user,
  workspace,
  initialUnreadCount,
}: HeaderProps) {
  const { d } = useI18n();
  const pathname = usePathname();
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

  const personal = workspace.active.kind === "personal";
  const home = personal ? "/home" : "/dashboard";
  const roleLabel = personal ? d.nav.roleCandidate : d.nav.roleRecruiter;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md backdrop-saturate-150">
      {/*
        The bar's contents share the page's measure, so the brand sits above
        the first column of content instead of floating off at the window's
        edge on a wide display. The background stays full-bleed.
      */}
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2 px-4 sm:px-6 lg:h-[72px] lg:gap-4 lg:px-8">
        {/*
          Below `lg` the top bar is not navigation, so it names the CURRENT
          page — derived from the route, so it changes as the reader moves.
        */}
        <h1 className="min-w-0 flex-1 truncate text-[15.5px] font-semibold tracking-tight text-ink lg:hidden">
          {pageTitleFor(pathname, d)}
        </h1>

        {/* Brand. The one place the accent appears at full strength in chrome. */}
        <Link
          href={home}
          className="hidden shrink-0 items-center gap-3 rounded-[10px] pr-1 text-ink lg:flex"
        >
          {/*
            36px, and the halo is the ONLY ambient light in the chrome. In
            dark mode `ai-halo` puts a faint violet bloom behind the mark,
            which on a navy bar reads as the product's own light; in light
            mode the same token is nearly invisible against blush, which is
            correct — a drop shadow under a small violet square on white
            looks like a rendering artefact, not like emphasis.
          */}
          <span className="btn-raised ai-halo flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-white">
            <SparkIcon className="size-[1.15rem]" />
          </span>
          {/*
            The wordmark yields before the navigation does. At 1024px the bar
            carries a brand, five areas and five utilities; the mark alone
            still identifies the product, and a nav item pushed off the end
            would not still be navigation.
          */}
          <span className="hidden min-w-0 xl:block">
            <span className="block truncate text-[16.5px] font-semibold leading-tight tracking-[-0.015em]">
              {d.meta.appName}
            </span>
            {/* Stays small and muted: the role is context for the brand, not
                a second line competing with it. */}
            <span className="block truncate text-[11px] leading-tight text-ink-subtle">
              {roleLabel}
            </span>
          </span>
        </Link>

        {/*
          Organization context, next to the brand where an account picker is
          expected. Candidates have exactly one workspace, so they get the
          role label above instead of a control with nothing to switch. It is
          capped tighter below `xl`, where the bar is at its most crowded.
        */}
        {personal ? null : (
          <div className="hidden min-w-0 max-w-[9rem] shrink lg:block xl:max-w-[11rem]">
            <WorkspaceSwitcher context={workspace} />
          </div>
        )}

        <div className="hidden h-full min-w-0 lg:flex">
          <TopNav
            workspace={workspace.active}
            entitlements={workspace.entitlements}
          />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/*
            The palette trigger doubles as the product's search affordance. It
            sheds its label and shortcut hint as the bar tightens, and on a
            phone it is the icon alone — the ⌘K hint is meaningless on a
            device with no ⌘ key.
          */}
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label={d.palette.open}
            className="hidden h-9 items-center gap-2 rounded-[10px] border border-line bg-surface-muted/60 px-2.5 text-ink-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted hover:text-ink sm:flex xl:pr-1.5"
          >
            <SearchIcon className="size-4 shrink-0" />
            <span className="hidden text-[13px] xl:block">{d.palette.title}</span>
            <kbd className="hidden rounded-[6px] border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-subtle xl:block">
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
              <span className="hidden text-[13px] font-medium text-ink xl:block">
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
                {/*
                  Session actions only. Every page in the product is one click
                  away in the bar to the left, and listing them again here
                  would make two menus responsible for the same thing.
                */}
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
      </div>
    </header>
  );
}
