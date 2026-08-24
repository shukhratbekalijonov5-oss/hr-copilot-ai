"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * Where a job seeker is INSIDE the external product.
 *
 * ## Second level, under the internal/external strip
 *
 * Choosing a universe happens above this, in `AiJobSearchTabs`. By the time a
 * reader sees this strip that choice is made, so these three entries are all
 * external: the search, the jobs kept from it, and the applications the reader
 * says they made. Repeating the internal link here would give the page two
 * competing answers to "where am I".
 *
 * Every entry is an EXTERNAL one. `/saved-jobs` and `/my-applications` are the
 * internal lists and are reached from the sidebar; nothing in this strip links
 * a reader from one world into the other expecting the same semantics.
 *
 * ## Why a link strip and not a tab widget
 *
 * Each entry is a real page with its own URL and its own server render, so it
 * is shareable, restorable and back-button-correct. `aria-current="page"`
 * carries the position for a screen reader; the tint alone never does.
 */
export function ExternalJobsTabs({
  current,
}: {
  current: "search" | "saved" | "applications";
}) {
  const { d } = useI18n();

  const entries = [
    { key: "search", href: "/external-jobs", label: d.externalJobs.searchTab },
    {
      key: "saved",
      href: "/external-jobs/saved",
      label: d.externalJobs.savedTab,
    },
    {
      key: "applications",
      href: "/external-jobs/applications",
      label: d.externalApplications.tab,
    },
  ] as const;

  return (
    <nav
      aria-label={d.externalJobs.tabsLabel}
      // `overflow-x-auto` and `whitespace-nowrap`: three entries do not fit a
      // 320px viewport, and a strip that scrolls sideways is better than one
      // that wraps into an unreadable block.
      className="flex w-full gap-1 overflow-x-auto rounded-lg border border-line bg-surface-muted p-1"
    >
      {entries.map((entry) =>
        entry.key === current ? (
          <span
            key={entry.key}
            aria-current="page"
            className="whitespace-nowrap rounded-md bg-surface px-3 py-1.5 text-[13px] font-medium text-ink shadow-card"
          >
            {entry.label}
          </span>
        ) : (
          <Link
            key={entry.key}
            href={entry.href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-muted hover:text-ink",
            )}
          >
            {entry.label}
          </Link>
        ),
      )}
    </nav>
  );
}
