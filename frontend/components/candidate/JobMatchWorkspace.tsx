"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  runJobMatchesAction,
  type JobMatchFailure,
} from "@/app/(candidate)/actions";
import { MatchCard } from "@/components/candidate/MatchCard";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/LoadingSkeleton";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { AlertIcon, CheckIcon, SparkIcon, UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { JobMatchResult } from "@/lib/types";

interface JobMatchWorkspaceProps {
  /** Whether the caller has created a candidate profile at all. */
  hasAccount: boolean;
  /** Whether a personal resume is uploaded. */
  hasResume: boolean;
  /** Headline/summary/skills/experience present — enough to match on. */
  hasProfileSignal: boolean;
}

/**
 * The candidate's AI job match surface.
 *
 * Matching is explicitly user-initiated: one click runs one backend call
 * (retrieval → rerank → deterministic requirement comparison → one grounded
 * explanation), which takes ~20 seconds. Nothing here re-runs it on renders
 * or navigation, and nothing is computed client-side — the page renders
 * exactly what the backend classified.
 */
export function JobMatchWorkspace({
  hasAccount,
  hasResume,
  hasProfileSignal,
}: JobMatchWorkspaceProps) {
  const { d, p } = useI18n();
  const [result, setResult] = useState<JobMatchResult | null>(null);
  const [failure, setFailure] = useState<JobMatchFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    if (pending) return;
    setFailure(null);

    startTransition(async () => {
      const response = await runJobMatchesAction();
      if (response.ok) {
        setResult(response.data);
      } else {
        setResult(null);
        setFailure(response.reason);
      }
    });
  }

  /* Readiness gates — matching needs something to match on. */

  const profileCta = (
    <Link
      href="/my-profile"
      className="inline-flex items-center rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-strong"
    >
      {d.jobMatch.completeProfile}
    </Link>
  );

  if (!hasAccount) {
    return (
      <Card>
        <EmptyState
          icon={<UserIcon className="size-5" />}
          title={d.jobMatch.needProfileTitle}
          description={d.jobMatch.needProfileHint}
          action={profileCta}
        />
      </Card>
    );
  }

  if (!hasResume && !hasProfileSignal) {
    return (
      <Card>
        <EmptyState
          icon={<SparkIcon className="size-5" />}
          title={d.jobMatch.notReadyTitle}
          description={d.jobMatch.notReadyHint}
          action={profileCta}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!hasResume ? (
        <p className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted sm:flex-row sm:items-start">
          <AlertIcon className="mt-px size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {d.jobMatch.resumeImproves}{" "}
            <Link
              href="/my-profile"
              className="font-medium text-brand-ink hover:text-brand"
            >
              {d.jobMatch.uploadResume}
            </Link>
          </span>
        </p>
      ) : null}

      {!result && !pending && !failure ? (
        <Card>
          <CardBody className="flex flex-col items-start gap-3 py-8">
            <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
              <SparkIcon className="size-5" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                {d.jobMatch.introTitle}
              </h2>
              <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-muted">
                {d.jobMatch.introHint}
              </p>
            </div>
            <Button onClick={run} icon={<SparkIcon className="size-4" />}>
              {d.jobMatch.run}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {pending ? <MatchLoading /> : null}

      {!pending && failure ? (
        <FailureNotice reason={failure} onRetry={run} />
      ) : null}

      {!pending && result ? (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-muted">
            <span>{p(d.jobMatch.matchCount, result.matches.length)}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={run}
              className="ml-auto"
            >
              {d.jobMatch.refresh}
            </Button>
          </div>

          {result.matches.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SparkIcon className="size-5" />}
                title={d.jobMatch.noMatches}
                description={d.jobMatch.noMatchesHint}
              />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {result.matches.map((match) => (
                <li key={match.vacancy.slug}>
                  <MatchCard match={match} generated={result.generated} />
                </li>
              ))}
            </ul>
          )}

          <p className="text-[12px] leading-relaxed text-ink-subtle">
            {d.jobMatch.coverageNote}
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * Staged loading copy for a ~20s synchronous call. The lines describe the
 * real pipeline stages in order; there are no percentages and no invented
 * progress — just words that change so the screen does not look frozen.
 */
function MatchLoading() {
  const { d } = useI18n();
  const lines = d.jobMatch.loadingStages;
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setStage((value) => Math.min(value + 1, lines.length - 1)),
      6000,
    );
    return () => clearInterval(timer);
  }, [lines.length]);

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <p
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-[13px] font-medium text-ink"
          >
            <SparkIcon className="size-4 animate-pulse text-brand" />
            {lines[stage]}
          </p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {lines.map((line, index) => {
              const active = index === stage;
              const complete = index < stage;
              return (
                <li
                  key={line}
                  aria-current={active ? "step" : undefined}
                  className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-muted"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted text-[11px]">
                    {complete ? (
                      <CheckIcon className="size-3 text-positive" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className={active ? "font-medium text-ink" : undefined}>
                    {line}
                  </span>
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}

function FailureNotice({
  reason,
  onRetry,
}: {
  reason: JobMatchFailure;
  onRetry: () => void;
}) {
  const { d } = useI18n();

  if (reason === "unavailable") {
    return (
      <UnavailableState
        icon={<SparkIcon className="size-5" />}
        title={d.jobMatch.unavailable}
        description={d.jobMatch.unavailableHint}
        action={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {d.common.retry}
          </Button>
        }
      />
    );
  }

  if (reason === "not_ready") {
    return (
      <Card>
        <EmptyState
          icon={<UserIcon className="size-5" />}
          title={d.jobMatch.notReadyTitle}
          description={d.jobMatch.notReadyHint}
        />
      </Card>
    );
  }

  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
    >
      <AlertIcon className="size-4 shrink-0" />
      {reason === "network" ? d.ai.networkFailed : d.errors.server}
      <Button
        variant="secondary"
        size="sm"
        onClick={onRetry}
        className="w-full sm:ml-auto sm:w-auto"
      >
        {d.common.retry}
      </Button>
    </p>
  );
}
