"use client";

import { useState, useTransition } from "react";
import { askAboutCandidateAction } from "@/app/(app)/candidates/[id]/actions";
import { AiFailureNotice } from "@/components/ai/AiFailureNotice";
import { CitationList } from "@/components/ai/CitationList";
import { GroundedText } from "@/components/ai/GroundedText";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonText } from "@/components/ui/LoadingSkeleton";
import { AnswerStatusBadge } from "@/components/ui/StatusBadge";
import { SearchIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_META } from "@/lib/i18n/locales";
import type { AiFailureReason, Citation, GroundedAnswer } from "@/lib/types";

interface AnswerPanelProps {
  candidateId: string;
  vacancyId?: string;
  ready: boolean;
  notReady: { title: string; description: string } | null;
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
}

/**
 * A grounded question-and-answer over one candidate's documents.
 *
 * The answer is written only from retrieved passages, and every claim carries a
 * citation the reader can open. `INSUFFICIENT_EVIDENCE` is displayed as a real
 * result rather than an error, because a refusal to improvise is the correct
 * behaviour — the alternative is a fluent paragraph with nothing behind it.
 */
export function AnswerPanel({
  candidateId,
  vacancyId,
  ready,
  notReady,
  onSelectCitation,
  activeCitationId,
}: AnswerPanelProps) {
  const { d, f } = useI18n();

  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [failure, setFailure] = useState<{
    reason: AiFailureReason;
    message?: string;
  } | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const [pending, startTransition] = useTransition();

  function ask() {
    if (pending) return;

    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setTooShort(true);
      return;
    }

    setTooShort(false);
    setFailure(null);

    startTransition(async () => {
      const result = await askAboutCandidateAction(
        candidateId,
        trimmed,
        vacancyId,
      );
      if (result.ok) setAnswer(result.data);
      else {
        setAnswer(null);
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
        <CardHeader title={d.ai.ask} description={d.ai.askDescription} />
        <CardBody>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
            className="flex flex-col gap-2.5"
          >
            <label htmlFor="ai-answer-query" className="sr-only">
              {d.ai.askLabel}
            </label>
            <textarea
              id="ai-answer-query"
              rows={3}
              value={query}
              disabled={pending}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  ask();
                }
              }}
              placeholder={d.ai.askPlaceholder}
              className="min-h-20 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px] leading-relaxed text-ink placeholder:text-ink-subtle disabled:opacity-60"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="text-[12px] text-ink-subtle">{d.search.hint}</p>
              <Button
                type="submit"
                size="sm"
                loading={pending}
                disabled={pending}
                icon={<SearchIcon className="size-4" />}
                className="sm:ml-auto"
              >
                {d.ai.askSubmit}
              </Button>
            </div>
            {tooShort ? (
              <p role="alert" className="text-[12.5px] text-critical">
                {d.ai.minQueryLength}
              </p>
            ) : null}
          </form>
        </CardBody>
      </Card>

      {pending ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <p
              role="status"
              aria-live="polite"
              className="text-[12.5px] text-ink-muted"
            >
              {d.ai.generatingAnswer}
            </p>
            <SkeletonText lines={4} />
          </CardBody>
        </Card>
      ) : null}

      {!pending && failure ? (
        <AiFailureNotice reason={failure.reason} message={failure.message} />
      ) : null}

      {!pending && answer ? (
        <Card>
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <AnswerStatusBadge status={answer.status} />
              <span className="text-[12px] text-ink-subtle">
                {LOCALE_META[answer.locale].label}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-2 text-[11.5px] text-ink-subtle">
                <span>
                  {f(d.ai.evidenceConsidered, {
                    count: answer.evidenceConsidered,
                  })}
                </span>
                {answer.model ? (
                  <span>
                    {d.ai.model}: {answer.model}
                  </span>
                ) : null}
              </span>
            </div>

            <GroundedText
              text={answer.answer}
              citations={answer.citations}
              onSelectCitation={onSelectCitation}
              activeCitationId={activeCitationId}
            />

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
              onSelectCitation={onSelectCitation}
              activeCitationId={activeCitationId}
              className="border-t border-line pt-3"
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
