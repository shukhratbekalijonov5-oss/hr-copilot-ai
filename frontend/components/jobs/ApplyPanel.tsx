"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { applyToJobAction } from "@/app/(candidate)/actions";
import { useOptionalJobMatchState } from "@/components/candidate/JobMatchStateProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { AlertIcon, CheckIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { CANDIDATE_STATUS_LABELS } from "@/lib/candidate/status";
import type { ApplyEligibility } from "@/lib/candidate/apply-eligibility";
import type { CandidateActionReason } from "@/lib/types";

interface ApplyPanelProps {
  slug: string;
  organizationName: string;
  /**
   * The state of this person's LATEST attempt at this job. A rejected latest
   * attempt means they may apply again — "has ever applied" is not the
   * question, and answering it that way bans a rejected candidate forever.
   */
  eligibility: ApplyEligibility;
  hasCandidateAccount: boolean;
}

/**
 * Applying to a public job.
 *
 * The backend does the real work — snapshotting the personal resume into the
 * hiring organization's namespace, creating the application, queueing AI
 * processing of the copy. This panel's job is to be honest about the outcome:
 * it never invents a status, and each failure names the specific thing missing
 * so the reader has a next step rather than a dead end.
 */
export function ApplyPanel({
  slug,
  organizationName,
  eligibility,
  hasCandidateAccount,
}: ApplyPanelProps) {
  const { d, f } = useI18n();
  const jobMatch = useOptionalJobMatchState();

  // Only a LIVE attempt shows the applied state. A rejected one leaves the
  // Apply action available and is shown as context above it.
  const [applied, setApplied] = useState(eligibility.kind === "active");
  const rejectedBefore = eligibility.kind === "can_reapply";
  const [failure, setFailure] = useState<CandidateActionReason | null>(null);
  const [pending, startTransition] = useTransition();

  function apply() {
    if (pending || applied) return;
    setFailure(null);

    startTransition(async () => {
      const result = await applyToJobAction(slug);
      if (result.ok) {
        setApplied(true);
        jobMatch?.patchApplicationState(slug, result.data.applicationState);
        return;
      }
      setFailure(result.reason);
    });
  }

  if (applied) {
    return (
      <Card>
        <CardBody className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <CheckIcon className="size-4 text-positive" />
            {d.jobs.applySucceeded}
          </p>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {f(d.jobs.applySucceededHint, { organization: organizationName })}
          </p>
          <Link
            href="/my-applications"
            className={buttonStyles("secondary", "sm", "self-start")}
          >
            {d.jobs.viewApplications}
          </Link>
        </CardBody>
      </Card>
    );
  }

  /**
   * The two blocking preconditions get their own screen rather than an error
   * toast: each needs a different page, and saying which one is missing is the
   * whole value of the message.
   */
  const missingProfile = !hasCandidateAccount || failure === "no_candidate_account";
  const missingResume = failure === "no_resume";

  if (missingProfile || missingResume) {
    return (
      <Card>
        <CardBody className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <AlertIcon className="size-4 text-warning" />
            {missingResume ? d.jobs.needsResume : d.jobs.needsProfile}
          </p>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {missingResume ? d.jobs.needsResumeHint : d.jobs.needsProfileHint}
          </p>
          <Link
            href="/my-profile"
            className={buttonStyles("primary", "sm", "self-start")}
          >
            {d.jobs.goToProfile}
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        {/*
          Says WHY the Apply button is back rather than pretending the earlier
          attempt never happened: the previous application stays in their
          history, and this is a new attempt at the same role.
        */}
        {rejectedBefore ? (
          <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-muted/50 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
            <AlertIcon className="mt-px size-4 shrink-0" />
            <span>
              {f(d.jobs.previousAttemptRejected, {
                status: CANDIDATE_STATUS_LABELS.REJECTED,
              })}{" "}
              <Link
                href="/my-applications"
                className="font-medium text-brand-ink hover:text-brand"
              >
                {d.jobs.viewApplications}
              </Link>
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            loading={pending}
            disabled={pending}
            onClick={apply}
            icon={<SparkIcon className="size-4" />}
          >
            {pending
              ? d.jobs.applying
              : rejectedBefore
                ? d.jobs.applyAgain
                : d.jobs.apply}
          </Button>
          <Badge tone="neutral">{d.status.applicationSource.DIRECT}</Badge>
        </div>

        <p className="text-[12.5px] leading-relaxed text-ink-subtle">
          {d.candidateProfile.personalResumeNote}
        </p>

        {failure === "already_applied" ? (
          <div role="alert" className="rounded-lg bg-warning-soft px-3 py-2">
            <p className="text-[13px] font-medium text-warning">
              {d.jobs.alreadyApplied}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-warning">
              {d.jobs.alreadyAppliedHint}
            </p>
          </div>
        ) : null}

        {failure === "job_unavailable" ? (
          <p
            role="alert"
            className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
          >
            {d.jobs.jobUnavailable}
          </p>
        ) : null}

        {failure === "network" ? (
          <p
            role="alert"
            className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
          >
            {d.errors.network}
          </p>
        ) : null}

        {failure === "unauthorized" || failure === "error" ? (
          <p
            role="alert"
            className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
          >
            {failure === "unauthorized"
              ? d.authErrors.generic
              : d.errors.server}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
