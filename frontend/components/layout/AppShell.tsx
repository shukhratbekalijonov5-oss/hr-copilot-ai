"use client";

import type { ReactNode } from "react";
import { BottomNav } from "@/components/layout/BottomNav";
import { Header } from "@/components/layout/Header";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import type { SessionUser } from "@/lib/types";
import type { WorkspaceContext } from "@/lib/workspace/types";

interface AppShellProps {
  user: SessionUser;
  workspace: WorkspaceContext;
  initialUnreadCount: number;
  children: ReactNode;
}

/**
 * The application frame: a bar at the top on desktop, one at the bottom on
 * mobile, and nothing else around the page.
 *
 * ## One column, not two
 *
 * There is no rail. Both bars render the same five areas from
 * `primary-nav.ts`, so the structure a reader learned on a phone is the
 * structure they meet on a laptop; only the edge it is anchored to changes.
 * `TopNav` is `hidden lg:flex` and `BottomNav` is `lg:hidden`, so exactly one
 * is usable at any width and neither is a fallback for the other.
 *
 * ## Width is capped, not filled
 *
 * The reclaimed 240px goes to the page, but not without limit: prose at
 * 2000px is unreadable and a table that wide separates a row's ends by more
 * than an eye can track. 1600px is wide enough for the split views this
 * product is built around — a list beside a preview, a chat beside its
 * evidence — and the cap is applied HERE so no screen has to remember it.
 * The header applies the same measure to its own contents so the brand lines
 * up with the first column of the page.
 */
export function AppShell({
  user,
  workspace,
  initialUnreadCount,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        user={user}
        workspace={workspace}
        initialUnreadCount={initialUnreadCount}
      />

      {/*
        `pb-24` on mobile pays for the fixed bottom bar: without it the bar
        covers whatever sits at the end of a page, and every screen would have
        to remember to leave room. One place, not thirty.
      */}
      {/*
        `overflow-x-clip` contains the decorative bleed.
        `.ambient-hero::before` and the spotlight washes are deliberately
        drawn wider than their container (`inset: … -20% … -20%`), which on a
        390px screen made the DOCUMENT 446px wide and gave every dashboard a
        horizontal scrollbar. `clip` rather than `hidden`: `hidden` would make
        this a scroll container and break `position: sticky` inside it, while
        `clip` only stops the painting from creating scrollable area. The
        wash still reaches the screen edges; it just no longer drags the page
        sideways.
      */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-x-clip px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
        {children}
      </main>

      <BottomNav
        workspace={workspace.active}
        entitlements={workspace.entitlements}
      />

      {/* One palette for the whole app; it derives its commands from the
          active workspace, so each side offers only its own routes. */}
      <CommandPalette workspace={workspace.active} />

      {/* Renders nothing until the browser says the app is installable, or
          the reader is on iOS where there is no such signal. */}
      <InstallPrompt />
    </div>
  );
}
