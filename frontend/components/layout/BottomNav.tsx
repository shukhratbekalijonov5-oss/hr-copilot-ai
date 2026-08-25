"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MobileSheet } from "@/components/layout/MobileSheet";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Entitlements } from "@/lib/entitlements/plan";
import {
  activeNavTab,
  navSectionsFor,
  primaryTabsFor,
  type NavSectionId,
} from "@/lib/workspace/primary-nav";
import type { Workspace } from "@/lib/workspace/types";

/**
 * The mobile primary navigation.
 *
 * ## It replaces the drawer, it does not supplement it
 *
 * Reaching a section used to mean opening a hamburger and scrolling a
 * desktop rail — two taps and a mental model borrowed from a screen three
 * times the width. Five fixed tabs put every area one thumb-reach away, and
 * the three that hold more than one page open a sheet instead of a page.
 *
 * The desktop bar renders the same five areas from the same module, so this
 * is the product's structure rather than a mobile arrangement of it.
 *
 * ## Fixed, and the content makes room
 *
 * The bar is `fixed` so it survives scrolling, which means it would otherwise
 * cover whatever sits at the bottom of a page. `AppShell` pays for that with
 * matching bottom padding rather than each screen remembering to.
 */
export function BottomNav({
  workspace,
  entitlements,
}: {
  workspace: Workspace;
  entitlements: Entitlements;
}) {
  const pathname = usePathname();
  const { d } = useI18n();
  const [openSheet, setOpenSheet] = useState<NavSectionId | null>(null);

  const tabs = primaryTabsFor(workspace);
  const sheets = navSectionsFor(workspace);
  const active = activeNavTab(tabs, pathname);

  const sheetCopy: Record<NavSectionId, { title: string; description: string }> = {
    career: { title: d.primaryNav.sections.career, description: d.primaryNav.sections.careerHint },
    hiring: { title: d.primaryNav.sections.hiring, description: d.primaryNav.sections.hiringHint },
    aiSearch: { title: d.primaryNav.sections.aiSearch, description: d.primaryNav.sections.aiSearchHint },
    more: { title: d.primaryNav.sections.more, description: d.primaryNav.sections.moreHint },
  };

  return (
    <>
      <nav
        aria-label={d.primaryNav.label}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="flex">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = active === tab.id;
            const label = d.nav[tab.labelKey];

            const inner = (
              <>
                {/*
                  A filled pill behind the icon as well as accent colour, so
                  the selected tab is not distinguished by hue alone.
                */}
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-[var(--motion-fast)]",
                    selected && "bg-brand-soft",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="max-w-full truncate text-[10.5px] leading-tight">
                  {label}
                </span>
              </>
            );

            const className = cn(
              "flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 pt-1.5",
              "transition-colors duration-[var(--motion-fast)]",
              selected ? "font-semibold text-brand-ink" : "text-ink-subtle",
            );

            return (
              <li key={tab.id} className="min-w-0 flex-1">
                {tab.href ? (
                  <Link
                    href={tab.href}
                    aria-current={selected ? "page" : undefined}
                    aria-label={label}
                    className={className}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    type="button"
                    aria-label={label}
                    /*
                      `aria-current` is valid on any element, not only links.
                      Career and AI Search are buttons that open a sheet, but
                      the section they represent can still be the current one
                      — without this, three of the five tabs would announce no
                      selected state at all.
                    */
                    aria-current={selected ? "page" : undefined}
                    aria-haspopup="dialog"
                    aria-expanded={openSheet === tab.section}
                    onClick={() => setOpenSheet(tab.section ?? null)}
                    className={className}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {openSheet ? (
        <MobileSheet
          open
          title={sheetCopy[openSheet].title}
          description={sheetCopy[openSheet].description}
          links={sheets[openSheet]}
          entitlements={entitlements}
          onClose={() => setOpenSheet(null)}
        />
      ) : null}
    </>
  );
}
