"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { CloseIcon, SparkIcon } from "@/components/ui/icons";
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  isNavItemActive,
  type NavItem,
} from "@/components/layout/nav";

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
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
      {item.label}
    </Link>
  );
}

interface SidebarProps {
  /** Rendered inside the mobile drawer, which needs a close affordance. */
  onNavigate?: () => void;
  onClose?: () => void;
}

export function Sidebar({ onNavigate, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center justify-between gap-2 border-b border-line px-4">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-white">
            <SparkIcon className="size-4" />
          </span>
          {APP_NAME}
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink lg:hidden"
          >
            <CloseIcon className="size-4.5" />
          </button>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3 scrollbar-slim">
        <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
          Workspace
        </p>
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isNavItemActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}

        <div className="mt-auto flex flex-col gap-0.5 pt-4">
          {SECONDARY_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isNavItemActive(pathname, item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>

      <div className="border-t border-line p-3">
        <p className="rounded-lg bg-surface-muted px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-muted">
          Every shortlist and rejection stays a human decision. The copilot only
          shows evidence.
        </p>
      </div>
    </div>
  );
}
