"use client";

import { useState, useTransition } from "react";
import { generateSummaryAction } from "@/app/(app)/candidates/[id]/actions";
import { AiFailureNotice } from "@/components/ai/AiFailureNotice";
import { CitationList } from "@/components/ai/CitationList";
import { GroundedText } from "@/components/ai/GroundedText";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonText } from "@/components/ui/LoadingSkeleton";
import { AnswerStatusBadge } from "@/components/ui/StatusBadge";
import { RefreshIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_META } from "@/lib/i18n/locales";
import type { AiFailureReason, CandidateSummary, Citation } from "@/lib/types";

interface SummaryPanelProps {
  candidateId: string;
  /** False while no document has finished indexing. */
  ready: boolean;
  /** Shown instead of the control when there is nothing to read yet. */
  notReady: { title: string; description: string } | null;
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
}

/**
 * A grounded summary of what the candidate's documents state.
 *
 * Three rules hold here. There is no fallback text — an unavailable generator
 * produces a notice, never a plausible-sounding paragraph. There is no quality
 * percentage. And there is no hire/reject suggestion: the summary reports what
 * the documents say, and the reader decides what it means.
 */
export function SummaryPanel({
  candidateId,
  ready,
  notReady,
  onSelectCitation,
  activeCitationId,
}: SummaryPanelProps) {
  const { d } = useI18n();

  const [summary, setSummary] = useState<CandidateSummary | null>(null);
  const [failure, setFailure] = useState<{
    reason: AiFailureReason;
    message?: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    if (pending) return;
    setFailure(null);

    startTransition(async () => {
      const result = await generateSummaryAction(candidateId);
      if (result.ok) setSummary(result.data);
      else {
        setSummary(null);
        setFailure({ reason: result.reason, message: result.message });
      }
    });
  }

  if (!ready && notReady) {
    return (
      <Card>
        <EmptyState
          icon={<SparkIcon className="size-5" />}
          title={notReady.title}
          description={notReady.description}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader
          title={d.ai.summaryTitle}
          description={d.ai.summaryDescription}
          action={
            <Button
              type="button"
              variant={summary ? "secondary" : "primary"}
              size="sm"
              loading={pending}
              disabled={pending}
              onClick={generate}
              icon={
                summary ? (
                  <RefreshIcon className="size-4" />
                ) : (
                  <SparkIcon className="size-4" />
                )
              }
            >
              {summary ? d.ai.summaryRegenerate : d.ai.summaryGenerate}
            </Button>
          }
        />

        <CardBody className="flex flex-col gap-3">
          {pending ? (
            <>
              <p
                role="status"
                aria-live="polite"
                className="text-[12.5px] text-ink-muted"
              >
                {d.ai.generatingAnswer}
              </p>
              <SkeletonText lines={4} />
            </>
          ) : null}

          {!pending && failure ? (
            <AiFailureNotice
              reason={failure.reason}
              message={failure.message}
            />
          ) : null}

          {!pending && !failure && !summary ? (
            <EmptyState
              title={d.ai.summaryEmpty}
              description={d.ai.summaryEmptyHint}
            />
          ) : null}

          {!pending && summary ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <AnswerStatusBadge status={summary.status} />
                <span className="text-[12px] text-ink-subtle">
                  {LOCALE_META[summary.locale].label}
                </span>
                {summary.model ? (
                  <span className="ml-auto text-[11.5px] text-ink-subtle">
                    {d.ai.model}: {summary.model}
                  </span>
                ) : null}
              </div>

              <GroundedText
                text={summary.summary}
                citations={summary.citations}
                onSelectCitation={onSelectCitation}
                activeCitationId={activeCitationId}
              />

              <p className="text-[12px] leading-relaxed text-ink-subtle">
                {summary.status === "GROUNDED"
                  ? d.ai.statusGroundedHint
                  : summary.status === "INSUFFICIENT_EVIDENCE"
                    ? d.ai.statusInsufficientHint
                    : d.ai.statusNeedsReviewHint}
              </p>

              <CitationList
                citations={summary.citations}
                onSelectCitation={onSelectCitation}
                activeCitationId={activeCitationId}
                className="border-t border-line pt-3"
              />
            </>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
