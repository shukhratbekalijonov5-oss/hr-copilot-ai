"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SparkIcon } from "@/components/ui/icons";
import { PremiumAiPanel } from "@/components/ai/PremiumAiPanel";
import { AiGenerationState } from "@/components/ai/AiGenerationState";
import { AiInsightList } from "@/components/ai/AiInsightList";
import { AiSummary } from "@/components/ai/AiSummary";
import { useI18n } from "@/lib/i18n/context";
import { explainExternalMatchAction } from "@/app/(candidate)/external-jobs/actions";
import {
  aiRequestFor,
  canStartAiRequest,
  failedAiRequest,
  idleAiRequest,
  readyAiRequest,
  startedAiRequest,
  type AiRequestState,
} from "@/lib/ai/premium-request";
import { createLatestRequestGate, runLatest } from "@/lib/candidate/latest-request";
import { isEmptyWhyMatch } from "@/lib/api/external-jobs-adapters";
import type { ExternalWhyMatch as WhyMatch } from "@/lib/types";

/**
 * "Why this match?" — Gemini's account of an already-computed ranking.
 *
 * ## It explains the score; it never becomes one
 *
 * The number and band on the card come from the deterministic ranker. Nothing
 * in this panel changes them, recomputes them, or shows a second figure beside
 * them. A model-authored percentage next to a computed one leaves a reader
 * choosing which to believe about their own prospects, and the one they would
 * choose is the fluent one.
 *
 * ## Nothing is generated until somebody asks
 *
 * The panel renders as a heading and a button. No request is made when the
 * search runs, when the results paint, when a card mounts, or when this drawer
 * opens — only when the button is pressed. Twenty results would otherwise mean
 * twenty model calls per search, paid for in latency by a reader who scrolled
 * past nineteen of them, and paid for in tokens by us.
 *
 * That is also why this lives in the DRAWER rather than on the card. On a card
 * it would be twenty buttons in a grid, one mis-tap away from a generation the
 * reader did not want. In the drawer they have already chosen this job.
 *
 * ## Two guards, for two different mistakes
 *
 * `canStartAiRequest` refuses a second press while one is in flight — the rule
 * that costs money when it is wrong. `runLatest` discards an answer that is no
 * longer the one being waited for, so an explanation generated for job A can
 * never paint under job B's title after the reader has moved on. Neither
 * substitutes for the other: the first stops a request being made, the second
 * stops a made request being believed.
 */
export function ExternalWhyMatch({
  externalJobId,
  headingId,
}: {
  externalJobId: string;
  headingId?: string;
}) {
  const { d } = useI18n();
  const [request, setRequest] = useState<AiRequestState<WhyMatch>>(() =>
    idleAiRequest<WhyMatch>(),
  );
  const gate = useRef(createLatestRequestGate());

  /*
   * The state as it applies to THIS job. A value left over from the previously
   * opened job reads as "nothing asked for yet" rather than being shown under
   * the wrong title — and is kept rather than cleared, so returning to a job
   * that was already explained shows its text again instead of spending a
   * second generation on the same paragraphs.
   */
  const current = aiRequestFor(request, externalJobId);

  function generate() {
    // Pressed twice, tapped twice, or pressed while already explained: all of
    // these stop here, before a request exists.
    if (!canStartAiRequest(request, externalJobId)) return;

    setRequest(startedAiRequest<WhyMatch>(externalJobId));

    void runLatest(gate.current, () => explainExternalMatchAction(externalJobId)).then(
      (outcome) => {
        // Superseded: the reader opened another job while this ran. Dropping
        // it in silence is correct — nobody is waiting for it, and rendering
        // its failure would flash an error over the job they DID open.
        if (outcome.stale) return;

        if (!outcome.ok) {
          setRequest(failedAiRequest<WhyMatch>(externalJobId, "error"));
          return;
        }

        const result = outcome.value;
        if (!result.ok) {
          setRequest(
            failedAiRequest<WhyMatch>(
              externalJobId,
              result.reason,
              result.requiredPlan ?? null,
            ),
          );
          return;
        }

        // A response that narrowed to nothing — no summary, no strengths, no
        // gaps — is reported as unavailable rather than rendered as an empty
        // panel. An explanation with nothing in it has not explained anything,
        // and "try again" is the truthful offer.
        if (isEmptyWhyMatch(result.explanation)) {
          setRequest(failedAiRequest<WhyMatch>(externalJobId, "unavailable"));
          return;
        }

        setRequest(readyAiRequest(externalJobId, result.explanation));
      },
    );
  }

  const explanation = current.status === "ready" ? current.value : null;
  const showButton = current.status === "idle";

  return (
    <PremiumAiPanel
      title={d.externalJobs.whyMatchTitle}
      headingId={headingId}
      action={
        showButton ? (
          <Button variant="secondary" size="sm" onClick={generate}>
            <SparkIcon className="size-3.5" aria-hidden="true" />
            {d.externalJobs.whyMatchGenerate}
          </Button>
        ) : null
      }
    >
      {/*
        The invitation, only before anything has been asked for. It says what
        pressing the button does, because "Why this match?" alone does not
        distinguish a disclosure from a generation the reader is choosing to
        spend time on.
      */}
      {showButton ? (
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {d.externalJobs.whyMatchInvite}
        </p>
      ) : null}

      <AiGenerationState
        status={current.status}
        capability="EXTERNAL_AI_SEARCH"
        requiredPlan={current.requiredPlan}
        onRetry={generate}
      />

      {explanation ? (
        <div className="flex flex-col gap-4">
          {explanation.summary ? <AiSummary text={explanation.summary} /> : null}

          <AiInsightList
            title={d.externalJobs.whyMatchStrengths}
            items={explanation.strengths}
            tone="positive"
          />
          {/*
            Gaps render only when there are gaps. `gaps: []` is a legitimate
            answer — a strong match with nothing to flag — and an empty
            "Potential gaps" box would read as a section that failed to load
            rather than as good news.
          */}
          <AiInsightList
            title={d.externalJobs.whyMatchGaps}
            items={explanation.gaps}
            tone="caution"
          />
        </div>
      ) : null}
    </PremiumAiPanel>
  );
}
