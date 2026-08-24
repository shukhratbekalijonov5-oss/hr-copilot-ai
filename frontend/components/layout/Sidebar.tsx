"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { CloseIcon, SparkIcon } from "@/components/ui/icons";
import {
  groupNavItems,
  isNavItemActive,
  navigationFor,
  type NavItem,
} from "@/lib/workspace/navigation";
import { PlanBadge } from "@/components/plan/PlanBadge";
import {
  allows,
  requiredPlanFor,
  type Entitlements,
} from "@/lib/entitlements/plan";
import type { Workspace } from "@/lib/workspace/types";

function NavLink({
  item,
  label,
  active,
  locked,
  onNavigate,
}: {
  item: NavItem;
  label: string;
  active: boolean;
  /** Shown with the plan it needs — still a real, focusable link. */
  locked: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
        active
          ? "bg-brand-soft text-brand-ink"
          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      <Icon className="size-4.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/*
        The plan a locked entry needs, named on the entry itself.

        It is a badge and not a `disabled` state on purpose: the link still
        works, and the page behind it explains the plan. A greyed-out nav item
        that swallows its own click is the worst of both — it neither opens
        nor tells you why.
      */}
      {locked && item.capability ? (
        <PlanBadge plan={requiredPlanFor(item.capability)} locked />
      ) : null}
    </Link>
  );
}

interface SidebarProps {
  workspace: Workspace;
  /**
   * What this account's plan unlocks, so a gated entry can wear its plan.
   * Purely presentational — the backend guards every one of these routes.
   */
  entitlements: Entitlements;
  /** Rendered inside the mobile drawer, which needs a close affordance. */
  onNavigate?: () => void;
  onClose?: () => void;
}

export function Sidebar({
  workspace,
  entitlements,
  onNavigate,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();
  const { d } = useI18n();
  const { primary, secondary } = navigationFor(workspace);
  const groups = groupNavItems(primary);
  // The recruiting side has one unlabelled group, so it keeps its old heading.
  const fallbackHeading =
    workspace.kind === "personal" ? d.nav.sectionJobSearch : d.nav.sectionWorkspace;

  // Nav items carry a dictionary key rather than a literal, so one definition
  // serves every locale.
  const labelFor = (item: NavItem) => d.nav[item.labelKey];

  const home = workspace.kind === "personal" ? "/jobs" : "/dashboard";

  return (
    <div className="flex h-full flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-line px-4">
        <Link
          href={home}
          onClick={onNavigate}
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-white">
            <SparkIcon className="size-4" />
          </span>
          {d.meta.appName}
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={d.nav.closeNavigation}
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink lg:hidden"
          >
            <CloseIcon className="size-4.5" />
          </button>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3 scrollbar-slim">
        {/*
          Headed groups rather than one flat list. The job-seeker side has
          three product areas — ordinary search, the paid AI searches, and the
          reader's own records — and a flat list made "AI Job Match" look like
          a peer of "Saved jobs" instead of half of a paid feature.
        */}
        {groups.map((group, index) => (
          <div key={group.labelKey ?? `group-${index}`} className={index > 0 ? "mt-3" : undefined}>
            <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {group.labelKey ? d.nav[group.labelKey] : fallbackHeading}
            </p>
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                label={labelFor(item)}
                active={isNavItemActive(pathname, item.href)}
                locked={Boolean(
                  item.capability && !allows(entitlements, item.capability),
                )}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}

        {secondary.length > 0 ? (
          <div className="mt-auto flex flex-col gap-0.5 pt-4">
            {secondary.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                label={labelFor(item)}
                active={isNavItemActive(pathname, item.href)}
                locked={Boolean(
                  item.capability && !allows(entitlements, item.capability),
                )}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ) : null}
      </nav>

      <div className="border-t border-line p-3">
        <p className="rounded-lg bg-surface-muted px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-muted">
          {workspace.kind === "personal"
            ? d.nav.notePersonal
            : d.nav.noteOrganization}
        </p>
      </div>
    </div>
  );
}
