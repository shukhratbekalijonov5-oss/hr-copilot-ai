"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SparkIcon } from "@/components/ui/icons";
import { PremiumAiPanel } from "@/components/ai/PremiumAiPanel";
import { AiGenerationState } from "@/components/ai/AiGenerationState";
import { AiTextDocument } from "@/components/ai/AiTextDocument";
import { AiCopyButton } from "@/components/ai/AiCopyButton";
import { useI18n } from "@/lib/i18n/context";
import { generateCoverLetterAction } from "@/app/(candidate)/external-jobs/actions";
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
import { coverLetterClipboardText } from "@/lib/ai/clipboard";
import { isEmptyCoverLetter } from "@/lib/api/external-jobs-adapters";
import type { ExternalCoverLetter as CoverLetter } from "@/lib/types";

/**
 * A first draft of a cover letter for one job.
 *
 * ## A draft, and it says so
 *
 * The invitation says the reader can copy and edit it wherever they send it.
 * That framing is the honest one: this is generated prose about somebody's own
 * career that will be read by an employer, and a product that presented it as
 * finished would be inviting people to send text they had not checked. The
 * panel's disclaimer carries the same warning above it.
 *
 * ## No regenerate button
 *
 * The backend caches its generation, so a second request for the same job
 * returns the same letter. A "Regenerate" that quietly returned identical text
 * would be a lie about what the button does — so there is no such button until
 * the backend offers a genuine cache bypass. `Try again` appears only on
 * failure, where there is nothing cached to return.
 *
 * ## Nothing is stored
 *
 * The letter lives in this component's state while the reader looks at it. No
 * draft is written back, so nothing here can later be mistaken for something
 * the candidate actually sent.
 */
export function ExternalCoverLetter({ externalJobId }: { externalJobId: string }) {
  const { d } = useI18n();
  const [request, setRequest] = useState<AiRequestState<CoverLetter>>(() =>
    idleAiRequest<CoverLetter>(),
  );
  const gate = useRef(createLatestRequestGate());

  const current = aiRequestFor(request, externalJobId);

  function generate() {
    // A second press while one is in flight, or after the letter is already
    // written, stops here — before a request exists. This is the guard that
    // costs real money when it is missing.
    if (!canStartAiRequest(request, externalJobId)) return;

    setRequest(startedAiRequest<CoverLetter>(externalJobId));

    void runLatest(gate.current, () => generateCoverLetterAction(externalJobId)).then(
      (outcome) => {
        // Superseded by a newer request: dropped in silence, so a letter
        // written for one job can never appear under another job's title.
        if (outcome.stale) return;

        if (!outcome.ok) {
          setRequest(failedAiRequest<CoverLetter>(externalJobId, "error"));
          return;
        }

        const result = outcome.value;
        if (!result.ok) {
          setRequest(
            failedAiRequest<CoverLetter>(
              externalJobId,
              result.reason,
              result.requiredPlan ?? null,
            ),
          );
          return;
        }

        // A subject with no body is not a letter. Reported as unavailable,
        // which offers a retry, rather than rendered as an empty page.
        if (isEmptyCoverLetter(result.letter)) {
          setRequest(failedAiRequest<CoverLetter>(externalJobId, "unavailable"));
          return;
        }

        setRequest(readyAiRequest(externalJobId, result.letter));
      },
    );
  }

  const letter = current.status === "ready" ? current.value : null;
  const showButton = current.status === "idle";

  return (
    <PremiumAiPanel
      title={d.externalJobs.coverLetterTitle}
      action={
        showButton ? (
          <Button variant="secondary" size="sm" onClick={generate}>
            <SparkIcon className="size-3.5" aria-hidden="true" />
            {d.externalJobs.coverLetterGenerate}
          </Button>
        ) : letter?.content ? (
          /*
            Copy replaces Generate once there is something to copy — the same
            slot, because the panel only ever offers one primary action and a
            row of two would leave the reader choosing between them.
          */
          <AiCopyButton
            value={coverLetterClipboardText(letter.subject, letter.content)}
            label={d.externalJobs.coverLetterCopyLabel}
          />
        ) : null
      }
    >
      {showButton ? (
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {d.externalJobs.coverLetterInvite}
        </p>
      ) : null}

      <AiGenerationState
        status={current.status}
        capability="EXTERNAL_AI_SEARCH"
        requiredPlan={current.requiredPlan}
        onRetry={generate}
      />

      {letter?.content ? (
        <AiTextDocument
          subject={letter.subject}
          subjectLabel={d.externalJobs.coverLetterSubject}
          content={letter.content}
        />
      ) : null}
    </PremiumAiPanel>
  );
}
