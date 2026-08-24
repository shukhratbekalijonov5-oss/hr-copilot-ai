"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SparkIcon } from "@/components/ui/icons";
import { PremiumAiPanel } from "@/components/ai/PremiumAiPanel";
import { AiGenerationState } from "@/components/ai/AiGenerationState";
import { AiInsightList } from "@/components/ai/AiInsightList";
import { AiQuestionList } from "@/components/ai/AiQuestionList";
import { useI18n } from "@/lib/i18n/context";
import { generateInterviewPrepAction } from "@/app/(candidate)/external-jobs/actions";
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
import { isEmptyInterviewPrep } from "@/lib/api/external-jobs-adapters";
import type { ExternalInterviewPrep as InterviewPrep } from "@/lib/types";

/**
 * Questions this job might bring, and how to think about them.
 *
 * ## Questions, not answers
 *
 * The panel shows what an interviewer may ask, why, and how to prepare. It
 * never shows a model-written answer in the reader's voice, never scores their
 * readiness, and never states a fact about their experience. Somebody who
 * walked into an interview having memorised a generated answer about a project
 * they did not do would be worse off than if this feature did not exist.
 *
 * ## Focus areas render only when there are some
 *
 * `focusAreas: []` is a legitimate answer and an empty box under a heading
 * reads as a section that failed to load — so `AiInsightList` returns null and
 * the heading goes with it. Focus areas reuse the strengths renderer because
 * `{title, guidance}` and `{title, explanation}` are the same shape doing the
 * same job; a second near-identical component would drift from the first.
 */
export function ExternalInterviewPrep({ externalJobId }: { externalJobId: string }) {
  const { d } = useI18n();
  const [request, setRequest] = useState<AiRequestState<InterviewPrep>>(() =>
    idleAiRequest<InterviewPrep>(),
  );
  const gate = useRef(createLatestRequestGate());

  const current = aiRequestFor(request, externalJobId);

  function generate() {
    if (!canStartAiRequest(request, externalJobId)) return;

    setRequest(startedAiRequest<InterviewPrep>(externalJobId));

    void runLatest(gate.current, () => generateInterviewPrepAction(externalJobId)).then(
      (outcome) => {
        if (outcome.stale) return;

        if (!outcome.ok) {
          setRequest(failedAiRequest<InterviewPrep>(externalJobId, "error"));
          return;
        }

        const result = outcome.value;
        if (!result.ok) {
          setRequest(
            failedAiRequest<InterviewPrep>(
              externalJobId,
              result.reason,
              result.requiredPlan ?? null,
            ),
          );
          return;
        }

        // Focus areas without questions is not interview prep: the reader
        // pressed the button for questions, and a panel without them reads as
        // broken rather than as sparse.
        if (isEmptyInterviewPrep(result.prep)) {
          setRequest(failedAiRequest<InterviewPrep>(externalJobId, "unavailable"));
          return;
        }

        setRequest(readyAiRequest(externalJobId, result.prep));
      },
    );
  }

  const prep = current.status === "ready" ? current.value : null;
  const showButton = current.status === "idle";

  return (
    <PremiumAiPanel
      title={d.externalJobs.interviewPrepTitle}
      action={
        showButton ? (
          <Button variant="secondary" size="sm" onClick={generate}>
            <SparkIcon className="size-3.5" aria-hidden="true" />
            {d.externalJobs.interviewPrepGenerate}
          </Button>
        ) : null
      }
    >
      {showButton ? (
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {d.externalJobs.interviewPrepInvite}
        </p>
      ) : null}

      <AiGenerationState
        status={current.status}
        capability="EXTERNAL_AI_SEARCH"
        requiredPlan={current.requiredPlan}
        onRetry={generate}
      />

      {prep ? (
        <div className="flex flex-col gap-4">
          <AiQuestionList
            title={d.externalJobs.interviewQuestions}
            questions={prep.questions}
          />
          <AiInsightList
            title={d.externalJobs.interviewFocusAreas}
            items={prep.focusAreas}
            tone="caution"
          />
        </div>
      ) : null}
    </PremiumAiPanel>
  );
}
