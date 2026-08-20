"use client";

import { use } from "react";
import { AiFailureNotice } from "@/components/ai/AiFailureNotice";
import { CitationList } from "@/components/ai/CitationList";
import { GroundedText } from "@/components/ai/GroundedText";
import { Card, CardBody } from "@/components/ui/Card";
import { SkeletonText } from "@/components/ui/LoadingSkeleton";
import { AnswerStatusBadge } from "@/components/ui/StatusBadge";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_META } from "@/lib/i18n/locales";
import type { AiActionResult } from "@/lib/api/ai-failure";
import type { GroundedAnswer } from "@/lib/types";

interface GroundedSummaryProps {
  /** Started by the page without awaiting; this component suspends on it. */
  result: Promise<AiActionResult<GroundedAnswer>>;
}

/**
 * The generated half of a search: a grounded answer over the organization's
 * indexed documents, streamed in whenever generation finishes — usually well
 * after the retrieval results below it.
 *
 * Every status is rendered as the backend reported it. INSUFFICIENT_EVIDENCE
 * is a real result, not an error: the model declined to write claims the
 * documents do not support, which is exactly what it is for. And a failure
 * here renders as its own notice — never by hiding the retrieval results,
 * which do not depend on generation.
 */
export function GroundedSummary({ result }: GroundedSummaryProps) {
  const { d, f } = useI18n();
  const response = use(result);

  if (!response.ok) {
    // A query long enough to search but too short to answer (the backend
    // requires one more character). Retrieval still ran; say why the summary
    // did not, rather than showing a 400.
    if (response.reason === "invalid") {
      return (
        <p className="rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-muted">
          {d.ai.minQueryLength}
        </p>
      );
    }
    return <AiFailureNotice reason={response.reason} message={response.message} />;
  }

  const answer = response.data;

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">
            {d.search.summaryTitle}
          </h2>
          <AnswerStatusBadge status={answer.status} />
          {/* Always the locale the backend REPORTED — an English answer to an
              Uzbek query is labelled English, never relabelled to match the
              UI. The fallback keeps an unknown code visible instead of
              crashing on contract drift. */}
          <span className="text-[12px] text-ink-subtle">
            {LOCALE_META[answer.locale]?.label ?? answer.locale}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-2 text-[11.5px] text-ink-subtle">
            <span>
              {f(d.ai.evidenceConsidered, { count: answer.evidenceConsidered })}
            </span>
            {answer.model ? (
              <span>
                {d.ai.model}: {answer.model}
              </span>
            ) : null}
          </span>
        </div>

        <GroundedText text={answer.answer} citations={answer.citations} />

        <p className="text-[12px] leading-relaxed text-ink-subtle">
          {answer.status === "GROUNDED"
            ? d.ai.statusGroundedHint
            : answer.status === "INSUFFICIENT_EVIDENCE"
              ? d.ai.statusInsufficientHint
              : d.ai.statusNeedsReviewHint}
        </p>

        <CitationList
          citations={answer.citations}
          answerText={answer.answer}
          className="border-t border-line pt-3"
        />
      </CardBody>
    </Card>
  );
}

/** Suspense fallback: generation is slow, and silence would look frozen. */
export function GroundedSummarySkeleton() {
  const { d } = useI18n();
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p role="status" aria-live="polite" className="text-[12.5px] text-ink-muted">
          {d.search.generatingSummary}
        </p>
        <SkeletonText lines={4} />
      </CardBody>
    </Card>
  );
}
