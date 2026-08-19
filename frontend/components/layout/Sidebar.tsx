"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { CloseIcon, SparkIcon } from "@/components/ui/icons";
import {
  isNavItemActive,
  navigationFor,
  type NavItem,
} from "@/lib/workspace/navigation";
import type { Workspace } from "@/lib/workspace/types";

function NavLink({
  item,
  label,
  active,
  onNavigate,
}: {
  item: NavItem;
  label: string;
  active: boolean;
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
      {label}
    </Link>
  );
}

interface SidebarProps {
  workspace: Workspace;
  /** Rendered inside the mobile drawer, which needs a close affordance. */
  onNavigate?: () => void;
  onClose?: () => void;
}

export function Sidebar({ workspace, onNavigate, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { d } = useI18n();
  const { primary, secondary } = navigationFor(workspace);

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
        <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
          {workspace.kind === "personal"
            ? d.nav.sectionJobSearch
            : d.nav.sectionWorkspace}
        </p>
        {primary.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            label={labelFor(item)}
            active={isNavItemActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}

        {secondary.length > 0 ? (
          <div className="mt-auto flex flex-col gap-0.5 pt-4">
            {secondary.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                label={labelFor(item)}
                active={isNavItemActive(pathname, item.href)}
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
