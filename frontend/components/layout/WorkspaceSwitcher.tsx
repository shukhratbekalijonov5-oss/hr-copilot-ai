"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { switchOrganizationAction } from "@/lib/auth/actions";
import { Badge } from "@/components/ui/Badge";
import {
  CheckIcon,
  ChevronDownIcon,
  SpinnerIcon,
  UserIcon,
} from "@/components/ui/icons";
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
 * Every entry is a real membership from `GET /auth/me`, with the role held in
 * that organization. Choosing one calls `POST /auth/switch-organization`, which
 * returns a new access token; the action stores it and invalidates the router
 * cache so no data from the previous workspace survives the switch.
 *
 * The candidate workspace needs no switch call at all — it is not an
 * organization, carries no role, and is reached by navigating.
 */
export function WorkspaceSwitcher({ context }: WorkspaceSwitcherProps) {
  const { d } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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

  const { active, organizations, personal, hasCandidateAccount } = context;

  function chooseOrganization(organizationId: string) {
    if (pending) return;
    setOpen(false);
    setError(null);

    if (
      active.kind === "organization" &&
      active.id === organizationId &&
      context.activeOrganizationId === organizationId
    ) {
      return;
    }

    startTransition(async () => {
      const result = await switchOrganizationAction(organizationId);
      if (!result.ok) {
        setError(result.message ?? d.workspaces.switchFailed);
        return;
      }
      // The action revalidated the tree; land on the new workspace's home.
      router.replace("/dashboard");
      router.refresh();
    });
  }

  const label = active.kind === "personal" ? d.workspaces.candidate : active.name;
  const sublabel =
    active.kind === "personal"
      ? d.nav.sectionJobSearch
      : d.status.role[active.role];
  const initial = (
    active.kind === "personal" ? personal.name : active.name
  ).slice(0, 1);

  return (
    <div className="relative min-w-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={pending}
        className="flex min-w-0 items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 hover:bg-surface-muted disabled:opacity-60"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold text-ink-muted">
          {pending ? (
            <SpinnerIcon className="size-3.5 animate-spin" />
          ) : (
            initial.toUpperCase()
          )}
        </span>
        <span className="min-w-0 text-left">
          <span className="block truncate text-[13.5px] font-medium leading-tight text-ink">
            {label}
          </span>
          <span className="block truncate text-[11px] leading-tight text-ink-subtle">
            {pending ? d.workspaces.switching : sublabel}
          </span>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-ink-subtle" />
      </button>

      {error ? (
        <p
          role="alert"
          className="absolute left-0 top-[calc(100%+0.4rem)] z-40 w-64 rounded-lg bg-critical-soft px-3 py-2 text-[12.5px] text-critical shadow-pop"
        >
          {error}
        </p>
      ) : null}

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+0.4rem)] z-40 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        >
          <div className="border-b border-line px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {d.workspaces.candidate}
            </p>
          </div>
          <div className="p-1">
            <Link
              href="/jobs"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              <UserIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {personal.name}
                <span className="block text-[11.5px] text-ink-subtle">
                  {hasCandidateAccount
                    ? d.workspaces.candidateHint
                    : d.workspaces.candidateNotSetUp}
                </span>
              </span>
              {active.kind === "personal" ? (
                <CheckIcon className="size-4 shrink-0 text-brand" />
              ) : null}
            </Link>
          </div>

          <div className="border-y border-line px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {d.workspaces.organizations}
            </p>
          </div>

          {organizations.length === 0 ? (
            <p className="px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-subtle">
              {d.workspaces.noOrganizations}
            </p>
          ) : (
            <div className="p-1">
              {organizations.map((organization) => {
                const isActive =
                  context.activeOrganizationId === organization.id;
                return (
                  <button
                    key={organization.id}
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => chooseOrganization(organization.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-muted disabled:opacity-60",
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
                    {isActive ? (
                      <CheckIcon className="size-4 shrink-0 text-brand" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {organizations.length > 1 ? (
            <p className="border-t border-line px-3 py-2 text-[11.5px] leading-relaxed text-ink-subtle">
              {d.workspaces.description}
              <Badge tone="neutral" className="ml-1.5">
                {organizations.length}
              </Badge>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
