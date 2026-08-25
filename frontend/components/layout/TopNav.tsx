"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { TopNavMenu } from "@/components/layout/TopNavMenu";
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
 * The desktop primary navigation.
 *
 * ## The bottom bar, moved to the top
 *
 * Same five areas, same order, same routes, same `activeNavTab` — this
 * renders `primary-nav.ts` exactly as `BottomNav` does. Someone who learned
 * where Saved jobs lives on their phone finds it in the same place here,
 * which is the entire reason the two bars were made to agree.
 *
 * ## Why this replaced a rail rather than joining one
 *
 * A persistent 240px column costs a sixth of a 1440px screen on every screen,
 * forever, to show eleven links a reader consults for a second at a time. The
 * split views this product is built around — a candidate list beside a
 * preview, a chat beside a transcript — are the things that actually wanted
 * that width. So navigation moved into 72px of vertical chrome that was
 * already there for the header, and the page got the column back.
 *
 * ## The active area is marked by an underline, not a filled block
 *
 * Colour alone would fail a reader who cannot distinguish it, and a saturated
 * pill in a header competes with the page's own primary action. A 2px rule
 * flush against the header's bottom border marks position structurally, and
 * reads at a glance without becoming the loudest thing on the screen.
 */
export function TopNav({
  workspace,
  entitlements,
}: {
  workspace: Workspace;
  entitlements: Entitlements;
}) {
  const pathname = usePathname();
  const { d } = useI18n();
  const [openId, setOpenId] = useState<NavSectionId | null>(null);

  const tabs = primaryTabsFor(workspace);
  const sections = navSectionsFor(workspace);
  const active = activeNavTab(tabs, pathname);

  const sectionCopy: Record<NavSectionId, { title: string; description: string }> = {
    career: { title: d.primaryNav.sections.career, description: d.primaryNav.sections.careerHint },
    hiring: { title: d.primaryNav.sections.hiring, description: d.primaryNav.sections.hiringHint },
    aiSearch: { title: d.primaryNav.sections.aiSearch, description: d.primaryNav.sections.aiSearchHint },
    more: { title: d.primaryNav.sections.more, description: d.primaryNav.sections.moreHint },
  };

  /*
   * One class for both kinds of area, so a link and a menu trigger are the
   * same object to a reader. `h-full` makes every item span the header, which
   * is what lets the underline sit flush on its bottom border.
   *
   * Spacing opens up at `xl` and stays tighter below it: at 1024px the bar
   * carries a brand, an organization picker, five areas and five utilities,
   * and the generous padding that suits 1440px is what would push the last
   * one off the end.
   */
  function itemClass(selected: boolean) {
    return cn(
      "relative flex h-full items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-[14.5px] font-medium xl:px-4",
      "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      selected ? "font-semibold text-brand-ink" : "text-ink-muted hover:text-ink",
    );
  }

  function indicator(selected: boolean) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-2.5 bottom-0 h-[2px] rounded-t-full transition-colors duration-[var(--motion-fast)] xl:inset-x-3",
          selected ? "bg-brand" : "bg-transparent",
        )}
      />
    );
  }

  return (
    <nav
      aria-label={d.primaryNav.label}
      className="hidden h-full min-w-0 items-stretch gap-1 lg:flex xl:gap-2"
    >
      {tabs.map((tab) => {
        const label = d.nav[tab.labelKey];
        const selected = active === tab.id;

        if (tab.href) {
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={selected ? "page" : undefined}
              className={itemClass(selected)}
            >
              {label}
              {indicator(selected)}
            </Link>
          );
        }

        if (!tab.section) return null;
        const section = tab.section;

        return (
          <TopNavMenu
            key={tab.id}
            id={section}
            label={label}
            description={sectionCopy[section].description}
            links={sections[section]}
            entitlements={entitlements}
            open={openId === section}
            active={selected}
            onOpen={() => setOpenId(section)}
            onClose={() => setOpenId(null)}
            onToggle={() =>
              setOpenId((current) => (current === section ? null : section))
            }
            triggerClassName={itemClass(selected)}
            indicator={indicator(selected)}
          />
        );
      })}
    </nav>
  );
}
