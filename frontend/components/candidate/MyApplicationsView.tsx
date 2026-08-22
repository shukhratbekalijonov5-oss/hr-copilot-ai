"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { withdrawApplicationAction } from "@/app/(candidate)/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertIcon, BriefcaseIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { ApplicationStatus, MyApplication } from "@/lib/types";

/**
 * Stages a candidate may still withdraw from.
 *
 * Mirrors the backend's list so the control is not offered where it would 409.
 * The backend stays authoritative: a stage that changed since this page
 * rendered is reported honestly rather than assumed away.
 */
const WITHDRAWABLE: ApplicationStatus[] = [
  "NEW",
  "REVIEWING",
  "INTERVIEW",
  "OFFER",
];

/**
 * The candidate's own applications.
 *
 * Shows what the backend lets a candidate see and nothing more — no recruiter
 * notes, no evidence, no other applicants, and no ranking. Stage labels use
 * applicant-facing wording rather than internal recruiter vocabulary.
 */
export function MyApplicationsView({
  applications,
}: {
  applications: MyApplication[];
}) {
  const { d, f, date } = useI18n();
  const [rows, setRows] = useState(applications);
  const [failure, setFailure] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function withdraw(id: string) {
    if (pending) return;
    setFailure(null);
    setBusyId(id);

    startTransition(async () => {
      const result = await withdrawApplicationAction(id);
      setBusyId(null);

      if (!result.ok) {
        setFailure(
          result.reason === "cannot_withdraw"
            ? d.applications.cannotWithdrawHint
            : (result.message ?? d.applications.withdrawFailed),
        );
        return;
      }
      setRows((current) =>
        current.map((row) => (row.id === id ? result.data : row)),
      );
    });
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<BriefcaseIcon className="size-5" />}
          title={d.applications.empty}
          description={d.applications.emptyHint}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {failure ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          {failure}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((application) => (
          <li key={application.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">
                    <Link
                      href={`/jobs/${application.job.publicSlug}`}
                      className="hover:text-brand"
                    >
                      {application.job.title}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-[13px] text-ink-muted">
                    {application.job.organizationName}
                    {application.job.location
                      ? ` · ${application.job.location}`
                      : ""}
                  </p>
                </div>
                <Badge tone="neutral">
                  {d.status.candidateStage[application.status]}
                </Badge>
              </div>

              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
                {d.status.candidateStageHint[application.status]}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[12px] text-ink-subtle">
                <span>
                  {f(d.applications.appliedOn, {
                    date: date(application.createdAt),
                  })}
                </span>

                {WITHDRAWABLE.includes(application.status) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    loading={busyId === application.id}
                    disabled={pending}
                    onClick={() => withdraw(application.id)}
                  >
                    {busyId === application.id
                      ? d.applications.withdrawing
                      : d.applications.withdraw}
                  </Button>
                ) : null}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p className="text-[12px] leading-relaxed text-ink-subtle">
        {d.applications.stageNote}
      </p>
    </div>
  );
}
