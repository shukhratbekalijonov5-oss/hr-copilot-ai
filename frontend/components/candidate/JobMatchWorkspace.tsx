"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { JobMatchFailure } from "@/app/(candidate)/actions";
import { useJobMatchState } from "@/components/candidate/JobMatchStateProvider";
import { MatchCard } from "@/components/candidate/MatchCard";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/LoadingSkeleton";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { AlertIcon, CheckIcon, SparkIcon, UserIcon } from "@/components/ui/icons";
import {
  canRunJobMatch,
  evidenceHint,
} from "@/lib/candidate/job-match-freshness";
import { useI18n } from "@/lib/i18n/context";

/**
 * The candidate's AI job match surface.
 *
 * Matching is explicitly user-initiated: one click runs one backend call
 * (retrieval → rerank → deterministic requirement comparison → one grounded
 * explanation), which takes ~20 seconds. Nothing here re-runs it on renders
 * or navigation, and nothing is computed client-side — the page renders
 * exactly what the backend classified.
 */
export function JobMatchWorkspace() {
  const { d, f, p } = useI18n();
  const {
    result,
    failure,
    pending,
    evidence,
    readinessPending,
    readinessFailure,
    stale,
    run,
    loadMore,
    loadingMore,
    clear,
  } = useJobMatchState();

  const hasAccount = evidence?.hasAccount ?? Boolean(result);
  // Files and links are equal evidence. A candidate with a portfolio and no
  // resume can match; a candidate with a full profile and neither cannot.
  const hasEvidence = evidence ? canRunJobMatch(evidence) : Boolean(result);
  const hint = evidenceHint(evidence);

  /* Readiness gates — matching needs EVIDENCE to match on. */

  const profileCta = (
    <Link
      href="/my-profile"
      className="inline-flex items-center rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-strong"
    >
      {d.jobMatch.goToProfile}
    </Link>
  );

  if (!result && readinessPending) {
    return <ReadinessLoading />;
  }

  if (!result && readinessFailure) {
    return <FailureNotice reason="network" onRetry={run} />;
  }

  if (!result && !hasAccount) {
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

  /*
    ZERO EVIDENCE.

    This gate ignores `result` on purpose. A candidate who deletes their last
    file must not keep seeing the analysis it produced — that analysis is a
    description of evidence that no longer exists, and leaving it on screen
    is the exact thing this rule forbids. The backend refuses to generate in
    this state too; this is the surface that stops the old answer lingering.
  */
  if (!hasEvidence) {
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
      {hint !== "none" ? (
        <p className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted sm:flex-row sm:items-start">
          <AlertIcon className="mt-px size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {/*
              With links but no resume the honest message is "this is working,
              a resume would add to it" — not "you have nothing", which is what
              the old resume-only wording implied.
            */}
            {hint === "resume-improves"
              ? d.jobMatch.resumeImprovesWithLinks
              : d.jobMatch.resumeImproves}{" "}
            <Link
              href="/my-profile"
              className="font-medium text-brand-ink hover:text-brand"
            >
              {d.jobMatch.uploadResume}
            </Link>
          </span>
        </p>
      ) : null}

      {stale && !pending ? <StaleNotice onRefresh={run} /> : null}

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

      {pending && !result ? <MatchLoading /> : null}

      {!result && !pending && failure ? (
        <FailureNotice reason={failure} onRetry={run} />
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-muted">
            {/*
              The count is the FULL ranked total, not the length of what has
              been loaded. Showing "20 matched roles" for a ranking of 148
              would be the same lie the old top-5 told.
            */}
            <span className={stale ? "text-ink-subtle line-through" : undefined}>
              {p(d.jobMatch.matchCount, result.total)}
              {result.matches.length < result.total
                ? ` · ${f(d.jobMatch.showingCount, {
                    shown: result.matches.length,
                    total: result.total,
                  })}`
                : ""}
            </span>
            <div className="ml-auto flex flex-col items-stretch gap-1 sm:items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clear}
              >
                {d.jobMatch.clearResults}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={run}
                loading={pending}
                disabled={pending}
              >
                {pending ? d.jobMatch.refreshing : d.jobMatch.refresh}
              </Button>
            </div>
          </div>

          {pending ? <BackgroundRefreshNotice /> : null}
          {!pending && failure ? <BackgroundRefreshError /> : null}

          {/*
            A stale result stays visible but is visibly not current: hiding it
            outright would look like a bug, and leaving it unmarked would let
            it pass for the present state of the candidate's evidence.
          */}
          {result.matches.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SparkIcon className="size-5" />}
                title={d.jobMatch.noMatches}
                description={d.jobMatch.noMatchesHint}
              />
            </Card>
          ) : (
            <ul
              className={
                stale
                  ? "flex flex-col gap-3 opacity-55"
                  : "flex flex-col gap-3"
              }
            >
              {result.matches.map((match) => (
                <li key={match.vacancy.slug}>
                  <MatchCard match={match} pending={result.explanationsPending} />
                </li>
              ))}
            </ul>
          )}

          {result.hasMore ? (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={loadMore}
                loading={loadingMore}
                disabled={loadingMore || pending}
              >
                {loadingMore ? d.jobMatch.loadingMore : d.jobMatch.loadMore}
              </Button>
            </div>
          ) : null}

          <p className="text-[12px] leading-relaxed text-ink-subtle">
            {d.jobMatch.coverageNote}
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * The displayed analysis no longer describes the candidate's evidence.
 *
 * Deliberately a call to action rather than a warning to dismiss: the fix is
 * one click, and the alternative — reading last week's conclusions about a
 * deleted file — is worse than a moment of friction.
 */
function StaleNotice({ onRefresh }: { onRefresh: () => void }) {
  const { d } = useI18n();

  return (
    <p
      role="status"
      className="flex flex-col gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning sm:flex-row sm:items-center"
    >
      <AlertIcon className="mt-px size-4 shrink-0" />
      <span className="min-w-0 flex-1">{d.jobMatch.staleNotice}</span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onRefresh}
        className="w-full sm:w-auto"
      >
        {d.jobMatch.refresh}
      </Button>
    </p>
  );
}

function ReadinessLoading() {
  const { d } = useI18n();

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p className="text-[13px] font-medium text-ink">{d.common.loading}</p>
        <SkeletonCard />
      </CardBody>
    </Card>
  );
}

function BackgroundRefreshNotice() {
  const { d } = useI18n();

  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-muted"
    >
      <SparkIcon className="size-4 animate-pulse text-brand" />
      {d.jobMatch.refreshingHint}
    </p>
  );
}

function BackgroundRefreshError() {
  const { d } = useI18n();

  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] leading-relaxed text-warning"
    >
      <AlertIcon className="mt-px size-4 shrink-0" />
      {d.jobMatch.refreshFailed}
    </p>
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
