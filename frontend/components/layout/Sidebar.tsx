"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { CloseIcon, LogoutIcon, SparkIcon } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/Avatar";
import { logoutAction } from "@/lib/auth/actions";
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
        "group relative flex items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5 text-[13.5px] font-medium",
        "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]",
        active
          ? "bg-brand-soft text-brand-ink"
          : "text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      {/*
        A 2px rail on the active row instead of colour alone. With eleven
        entries the filled pill was the loudest thing on the screen; the rail
        marks position while letting the labels stay the thing you read.
      */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full",
          active ? "bg-brand" : "bg-transparent",
        )}
      />
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
  /**
   * The signed-in account, shown in the footer on the job-seeker side. Absent
   * on the recruiting side, which keeps its standing note there instead.
   */
  account?: { fullName: string; email: string; avatarUrl: string | null } | null;
  /** Rendered inside the mobile drawer, which needs a close affordance. */
  onNavigate?: () => void;
  onClose?: () => void;
}

export function Sidebar({
  workspace,
  entitlements,
  account,
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

  const home = workspace.kind === "personal" ? "/home" : "/dashboard";
  // Purely presentational: the backend guards both capabilities regardless.
  const showUpgrade =
    workspace.kind === "personal" &&
    (!allows(entitlements, "INTERNAL_AI_SEARCH") ||
      !allows(entitlements, "EXTERNAL_AI_SEARCH"));

  return (
    <div className="flex h-full flex-col border-r border-line bg-elevated backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-line px-4">
        <Link
          href={home}
          onClick={onNavigate}
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink"
        >
          {/* The one place the accent appears at full strength in the chrome. */}
          <span className="btn-raised ai-halo flex size-7 items-center justify-center rounded-[9px] bg-brand text-white">
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
            <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">
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

      {/*
        The upgrade prompt, shown ONLY when the plan genuinely withholds
        something — `allows()` is the same check the nav entries use, so this
        card cannot appear for someone who already has both AI searches. It is
        a quiet accent panel rather than a banner: a permanent advertisement
        in a product someone is paying to use is a tax on every session.
      */}
      {account && showUpgrade ? (
        <div className="px-3 pb-1">
          <Link
            href="/plans"
            onClick={onNavigate}
            className="accent-panel card-interactive block rounded-[12px] border border-line p-3"
          >
            <span className="flex items-center gap-1.5">
              <SparkIcon className="size-3.5 text-brand" />
              <span className="text-[12.5px] font-semibold text-ink">
                {d.plans.title}
              </span>
            </span>
            <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-muted">
              {d.nav.upgradeHint}
            </span>
          </Link>
        </div>
      ) : null}

      {/*
        Who you are signed in as, at the bottom where every product puts it.
        The recruiting side keeps its standing note instead: that side is a
        shared workspace, and whose account it is matters less there.
      */}
      {account ? (
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 rounded-[10px] border border-transparent px-1.5 py-1.5 transition-colors duration-[var(--motion-fast)] hover:border-line hover:bg-surface">
            <Avatar name={account.fullName} src={account.avatarUrl} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">
                {account.fullName}
              </span>
              <span className="block truncate text-[11.5px] text-ink-muted">
                {account.email}
              </span>
            </span>
            <form action={logoutAction} className="shrink-0">
              <button
                type="submit"
                aria-label={d.nav.signOut}
                title={d.nav.signOut}
                className="flex size-8 items-center justify-center rounded-md text-ink-subtle transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted hover:text-ink"
              >
                <LogoutIcon className="size-4" />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="border-t border-line p-3">
          {/*
            The recruiter plans PREVIEW. It says "coming soon" on the teaser
            itself, because a sidebar upsell for something nobody can buy is
            only honest if the unavailability is visible before the click.
          */}
          <Link
            href="/plans"
            onClick={onNavigate}
            className="accent-panel card-interactive mb-2 block rounded-[12px] border border-line p-3"
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <SparkIcon className="size-3.5 text-brand" />
              <span className="text-[12.5px] font-semibold text-ink">
                {d.recruiterPlans.title}
              </span>
              <span className="rounded-[4px] bg-brand-soft px-1 py-px text-[10.5px] font-medium uppercase tracking-wide text-brand-ink">
                {d.recruiterPlans.comingSoon}
              </span>
            </span>
            <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-muted">
              {d.recruiterPlans.description}
            </span>
          </Link>
          <p className="rounded-lg bg-surface-muted px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-muted">
            {d.nav.noteOrganization}
          </p>
        </div>
      )}
    </div>
  );
}
