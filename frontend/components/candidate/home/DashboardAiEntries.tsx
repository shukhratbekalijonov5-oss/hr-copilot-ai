"use client";

import Link from "next/link";
import { GlobeIcon, SparkIcon } from "@/components/ui/icons";
import { PlanBadge } from "@/components/plan/PlanBadge";
import { useI18n } from "@/lib/i18n/context";
import {
  allows,
  requiredPlanFor,
  type Entitlements,
} from "@/lib/entitlements/plan";
import { cn } from "@/lib/utils";
import { useSpotlight } from "@/lib/ui/use-spotlight";

/**
 * The two doors into the paid product, side by side on the dashboard.
 *
 * ## Both are always shown, locked or not
 *
 * A locked entry keeps its plan badge and stays a real link — the page behind
 * it explains the plan. Hiding it would make a purchasing decision invisible
 * to the person who might make it, which is the same rule the sidebar
 * follows. Nothing here is a security boundary; the backend guards both.
 *
 * ## They never merge
 *
 * Internal ranks vacancies where applying happens inside this product;
 * external ranks jobs where applying happens on the employer's own site and
 * the outcome is never observable here. One blended card would have to make
 * a single promise about two different things.
 */
export function DashboardAiEntries({
  entitlements,
}: {
  entitlements: Entitlements;
}) {
  const { d } = useI18n();
  const onPointerMove = useSpotlight();

  const entries = [
    {
      href: "/job-matches",
      icon: SparkIcon,
      title: d.nav.internalAiJobs,
      description: d.home.entries.internalHint,
      capability: "INTERNAL_AI_SEARCH" as const,
    },
    {
      href: "/external-jobs",
      icon: GlobeIcon,
      title: d.nav.externalAiJobs,
      description: d.home.entries.externalHint,
      capability: "EXTERNAL_AI_SEARCH" as const,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {entries.map((entry) => {
        const Icon = entry.icon;
        const unlocked = allows(entitlements, entry.capability);

        return (
          <Link
            key={entry.href}
            href={entry.href}
            onPointerMove={onPointerMove}
            className={cn(
              "card-interactive ai-edge spotlight group relative overflow-hidden rounded-[14px] border p-4",
              // An unlocked AI surface carries the accent tint and halo. A
              // locked one stays neutral, so the glow reads as "this is
              // yours" rather than as decoration on an advertisement.
              unlocked
                ? "border-ai-line bg-ai-tint"
                : "border-line bg-surface",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
                  unlocked ? "bg-ai-ink/10 text-ai-ink" : "bg-surface-muted text-ink-subtle",
                )}
              >
                <Icon className="size-4.5" />
              </span>
              {!unlocked ? (
                <PlanBadge plan={requiredPlanFor(entry.capability)} locked />
              ) : null}
            </div>

            <h3 className="mt-3 text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
              {entry.title}
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              {entry.description}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
