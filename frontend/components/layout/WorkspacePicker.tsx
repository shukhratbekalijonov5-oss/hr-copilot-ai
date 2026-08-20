"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { switchOrganizationAction } from "@/lib/auth/actions";
import {
  ArrowRightIcon,
  BuildingIcon,
  SpinnerIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { Membership } from "@/lib/types";

interface WorkspacePickerProps {
  memberships: Membership[];
}

/**
 * Choosing which organization workspace to open.
 *
 * Candidate accounts never reach this page. Multi-organization switching
 * remains valid for ORGANIZATION accounts, and this picker shows only those
 * real memberships.
 */
export function WorkspacePicker({ memberships }: WorkspacePickerProps) {
  const { d } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(organizationId: string) {
    if (pending) return;
    setError(null);
    setBusyId(organizationId);

    startTransition(async () => {
      const result = await switchOrganizationAction(organizationId);
      if (!result.ok) {
        setBusyId(null);
        setError(result.message ?? d.workspaces.switchFailed);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          {error}
        </p>
      ) : null}

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
          {d.workspaces.organizations}
        </p>
        {memberships.length === 0 ? (
          <p className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink-muted">
            <BuildingIcon className="mt-px size-4 shrink-0" />
            {d.workspaces.noOrganizationsHint}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {memberships.map((membership) => (
              <button
                key={membership.organization.id}
                type="button"
                disabled={pending}
                onClick={() => choose(membership.organization.id)}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 text-left shadow-card transition-colors hover:border-line-strong hover:bg-surface-muted/50 disabled:opacity-60"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-[13px] font-semibold text-ink-muted">
                  {busyId === membership.organization.id ? (
                    <SpinnerIcon className="size-4 animate-spin" />
                  ) : (
                    membership.organization.name.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">
                    {membership.organization.name}
                  </span>
                  <span className="block text-[12.5px] text-ink-muted">
                    {d.status.role[membership.role]}
                  </span>
                </span>
                <ArrowRightIcon className="size-4 shrink-0 text-ink-subtle" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
