"use client";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/LoadingSkeleton";
import { AlertIcon, SparkIcon } from "@/components/ui/icons";
import { PlanLockedCard } from "@/components/plan/PlanLockedCard";
import { useI18n } from "@/lib/i18n/context";
import { isRetryable, type AiGenerationStatus } from "@/lib/ai/premium-request";
import { requiredPlanFor, type CandidatePlan, type PlanCapability } from "@/lib/entitlements/plan";

/**
 * Everything an on-demand generation can look like except its result.
 *
 * ## Four outcomes, four screens — because "Something went wrong" is wrong
 *
 * Collapsing these would be the single most damaging shortcut available here.
 * They call for opposite things:
 *
 *   - `plan_required` is NOT a failure. Nothing broke, the reader is simply on
 *     a plan that does not include this, and there is a concrete thing they can
 *     do. It renders the paywall — and deliberately renders NO retry, because
 *     the request would be refused identically forever and a Retry button in
 *     front of a paywall is the cruellest control this product could ship.
 *   - `unavailable` is the model or its queue briefly unable. Nothing was
 *     generated and nothing is stale, so "try again" is both true and useful.
 *   - `gone` means the job left the catalogue. Retrying cannot bring it back,
 *     so no retry is offered here either.
 *   - `error` is everything else, and only this one gets the generic wording.
 *
 * ## The loading state is a shape, not a spinner
 *
 * Skeleton lines the width of the paragraphs about to replace them, so the
 * panel does not jump when the text lands. `aria-busy` with a polite live
 * region tells a screen-reader user that something is being generated and,
 * critically, is NOT presented as an error while it is still working.
 */
export function AiGenerationState({
  status,
  capability,
  requiredPlan,
  onRetry,
}: {
  status: AiGenerationStatus;
  /** Which capability this feature belongs to, for the paywall's copy. */
  capability: PlanCapability;
  /** The plan the backend named, when it named one. */
  requiredPlan?: CandidatePlan | null;
  onRetry: () => void;
}) {
  const { d } = useI18n();

  if (status === "loading") {
    return (
      <div
        // `aria-busy` plus a polite announcement: a reader who cannot see the
        // skeleton is told generation is under way, once, without the region
        // chattering as each line paints.
        aria-busy="true"
        aria-live="polite"
        className="flex flex-col gap-2"
      >
        <p className="flex items-center gap-2 text-[12.5px] text-ink-muted">
          <SparkIcon className="size-3.5 animate-pulse" aria-hidden="true" />
          {d.premiumAi.generating}
        </p>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  }

  if (status === "plan_required") {
    // The paywall, not an error box — same component the gated pages use, so
    // one upgrade experience exists in the product rather than two.
    return (
      <PlanLockedCard
        capability={capability}
        requiredPlan={requiredPlan ?? requiredPlanFor(capability)}
      />
    );
  }

  if (status === "gone" || status === "unavailable" || status === "error") {
    const message =
      status === "gone"
        ? d.premiumAi.jobGone
        : status === "unavailable"
          ? d.premiumAi.unavailable
          : d.premiumAi.failed;

    return (
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
        <p className="flex min-w-0 items-start gap-2 text-[12.5px] leading-relaxed text-ink-muted">
          <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span className="break-words">{message}</span>
        </p>
        {/*
          Retry only where retrying can work. `gone` and `plan_required` do not
          reach a button, so nothing here can offer an action that is
          guaranteed to fail.
        */}
        {isRetryable(status) ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRetry}
            className="sm:ml-auto"
          >
            {d.premiumAi.tryAgain}
          </Button>
        ) : null}
      </div>
    );
  }

  return null;
}
