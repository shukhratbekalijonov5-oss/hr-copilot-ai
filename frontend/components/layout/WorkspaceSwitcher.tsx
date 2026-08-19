"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { CheckIcon, ChevronDownIcon, UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { WorkspaceContext } from "@/lib/workspace/types";

interface WorkspaceSwitcherProps {
  context: WorkspaceContext;
}

/**
 * Switches between the user's own job-seeking space and the organizations they
 * belong to, without signing out.
 *
 * Only what the backend can actually back is navigable. The personal workspace
 * is listed so the two-sided shape of the product is visible, but it stays
 * disabled — with the reason shown — until a CandidateAccount exists.
 */
export function WorkspaceSwitcher({ context }: WorkspaceSwitcherProps) {
  const { d } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const { active, organizations, personal, personalAvailable } = context;
  const initial =
    active.kind === "personal" ? personal.name.slice(0, 1) : active.name.slice(0, 1);

  return (
    <div className="relative min-w-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-w-0 items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 hover:bg-surface-muted"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold text-ink-muted">
          {initial.toUpperCase()}
        </span>
        <span className="min-w-0 text-left">
          <span className="block truncate text-[13.5px] font-medium leading-tight text-ink">
            {active.kind === "personal" ? d.nav.personal : active.name}
          </span>
          <span className="block truncate text-[11px] leading-tight text-ink-subtle">
            {active.kind === "personal"
              ? d.nav.sectionJobSearch
              : d.status.role[active.role]}
          </span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-ink-subtle" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+0.4rem)] z-40 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        >
          <div className="border-b border-line px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {d.nav.personal}
            </p>
          </div>
          <div className="p-1">
            {personalAvailable ? (
              <Link
                href="/jobs"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <UserIcon className="size-4" />
                <span className="min-w-0 flex-1 truncate">
                  {personal.name}
                  <span className="block text-[11.5px] text-ink-subtle">
                    {d.nav.sectionJobSearch}
                  </span>
                </span>
                {active.kind === "personal" ? (
                  <CheckIcon className="size-4 text-brand" />
                ) : null}
              </Link>
            ) : (
              <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 opacity-60">
                <UserIcon className="mt-0.5 size-4 text-ink-subtle" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink-muted">
                    {personal.name}
                  </span>
                  <span className="block text-[11.5px] leading-snug text-ink-subtle">
                    {d.nav.personalUnavailable}
                  </span>
                </span>
              </div>
            )}
          </div>

          <div className="border-y border-line px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {d.nav.organizations}
            </p>
          </div>
          <div className="p-1">
            {organizations.map((organization) => {
              const isActive =
                active.kind === "organization" && active.id === organization.id;
              return (
                <Link
                  key={organization.id}
                  href="/dashboard"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-surface-muted",
                    isActive ? "text-ink" : "text-ink-muted hover:text-ink",
                  )}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold text-ink-muted">
                    {organization.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {organization.name}
                    <span className="block text-[11.5px] text-ink-subtle">
                      {d.status.role[organization.role]}
                    </span>
                  </span>
                  {isActive ? <CheckIcon className="size-4 text-brand" /> : null}
                </Link>
              );
            })}
          </div>

          <p className="border-t border-line px-3 py-2 text-[11.5px] leading-relaxed text-ink-subtle">
            {d.nav.multiOrganizationNote}
            <Badge tone="neutral" className="ml-1.5">
              {d.nav.oneOfOne}
            </Badge>
          </p>
        </div>
      ) : null}
    </div>
  );
}
