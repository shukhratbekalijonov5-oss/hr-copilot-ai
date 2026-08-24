"use client";

import Link from "next/link";
import { PlanBadge } from "@/components/plan/PlanBadge";
import { LockIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { requiredPlanFor, type Entitlements } from "@/lib/entitlements/plan";
import { cn } from "@/lib/utils";

/**
 * The two AI job searches, and the line between them.
 *
 * ## Two universes, never one ranked list
 *
 * Internal ranks vacancies published INSIDE HR Copilot: applying happens here,
 * the recruiter is a customer of ours, and this product can tell the candidate
 * what happened next. External ranks jobs published anywhere else: applying
 * happens on the employer's own site and we never learn the outcome.
 *
 * A single blended board would have to choose one Apply button for those two
 * promises, and whichever it chose would be a lie about half its rows. So the
 * separation is structural — two routes, two server renders, two result sets —
 * and this strip is where a reader sees that it exists and chooses a side.
 *
 * ## The locked tab is visible, labelled, and clickable
 *
 * A tab that disappears on the cheaper plan teaches a reader that the product
 * is smaller than it is. This one stays, wears the plan it needs, and leads to
 * a page that explains it. Nothing here is a permission check: the backend
 * refuses the data independently, and this strip only decides what to show.
 *
 * ## Why links and not a tab widget
 *
 * Each side is a real page with its own URL, its own server render and its own
 * back-button behaviour. `aria-current="page"` carries the position for a
 * screen reader — the tint alone never does — and every entry is a native
 * anchor, so keyboard focus, Enter, and open-in-new-tab all work without a
 * single key handler.
 */
export function AiJobSearchTabs({
  current,
  entitlements,
}: {
  current: "internal" | "external";
  entitlements: Entitlements;
}) {
  const { d, f } = useI18n();

  const entries = [
    {
      key: "internal",
      href: "/job-matches",
      label: d.aiJobSearch.internalTab,
      locked: !entitlements.canUseInternalAiJobs,
      plan: requiredPlanFor("INTERNAL_AI_SEARCH"),
    },
    {
      key: "external",
      href: "/external-jobs",
      label: d.aiJobSearch.externalTab,
      locked: !entitlements.canUseExternalAiJobs,
      plan: requiredPlanFor("EXTERNAL_AI_SEARCH"),
    },
  ] as const;

  return (
    <nav
      aria-label={d.aiJobSearch.tabsLabel}
      /*
       * `overflow-x-auto` with `whitespace-nowrap` entries: at 320px two
       * labels plus a plan badge do not fit, and a strip that scrolls
       * sideways stays readable where one that wraps becomes a block of
       * text nobody recognises as navigation.
       */
      className="mb-4 flex w-full gap-1 overflow-x-auto rounded-lg border border-line bg-surface-muted p-1"
    >
      {entries.map((entry) => {
        const isCurrent = entry.key === current;
        const content = (
          <>
            {entry.locked ? (
              <LockIcon className="size-3.5 shrink-0" aria-hidden="true" />
            ) : null}
            {entry.label}
            {/*
              The MAX marker rides on the tab itself rather than only on the
              page behind it, so the cost is legible before the click.
              External always shows its plan; internal shows it only when
              locked, because a badge on a tab you already own is noise.
            */}
            {entry.key === "external" || entry.locked ? (
              <PlanBadge plan={entry.plan} locked={entry.locked} />
            ) : null}
          </>
        );

        const shared =
          "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

        return isCurrent ? (
          <span
            key={entry.key}
            aria-current="page"
            className={cn(shared, "bg-surface text-ink shadow-card")}
          >
            {content}
          </span>
        ) : (
          <Link
            key={entry.key}
            href={entry.href}
            /*
             * The accessible name spells out the plan requirement, because
             * "External AI Jobs" followed by a separate badge is two
             * announcements a reader has to join up themselves.
             */
            aria-label={
              entry.locked
                ? f(d.aiJobSearch.lockedTabLabel, {
                    tab: entry.label,
                    plan: d.plans.names[entry.plan],
                  })
                : undefined
            }
            className={cn(shared, "text-ink-muted hover:bg-surface hover:text-ink")}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
