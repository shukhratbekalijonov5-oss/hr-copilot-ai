"use client";

import { useState, useTransition } from "react";
import { generateInterviewQuestionsAction } from "@/app/(app)/candidates/[id]/actions";
import { AiFailureNotice } from "@/components/ai/AiFailureNotice";
import { CitationList } from "@/components/ai/CitationList";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/LoadingSkeleton";
import { RefreshIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_META } from "@/lib/i18n/locales";
import type {
  AiFailureReason,
  Citation,
  InterviewQuestionSet,
} from "@/lib/types";

interface InterviewQuestionsPanelProps {
  candidateId: string;
  /** Null when the candidate is not attached to a vacancy. */
  vacancyId: string | null;
  ready: boolean;
  notReady: { title: string; description: string } | null;
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
}

/**
 * Prompts for a human interviewer.
 *
 * These are questions to ask, not findings. `evidence_probe` follows up on
 * something the documents show; `missing_requirement_probe` covers a
 * requirement they do not mention. Neither is an assessment of the candidate,
 * and the panel never presents them as one.
 */
export function InterviewQuestionsPanel({
  candidateId,
  vacancyId,
  ready,
  notReady,
  onSelectCitation,
  activeCitationId,
}: InterviewQuestionsPanelProps) {
  const { d } = useI18n();

  const [result, setResult] = useState<InterviewQuestionSet | null>(null);
  const [failure, setFailure] = useState<{
    reason: AiFailureReason;
    message?: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    if (pending || !vacancyId) return;
    setFailure(null);

    startTransition(async () => {
      const response = await generateInterviewQuestionsAction(
        candidateId,
        vacancyId,
      );
      if (response.ok) setResult(response.data);
      else {
        setResult(null);
        setFailure({ reason: response.reason, message: response.message });
      }
    });
  }

  if (!vacancyId) {
    return (
      <Card>
        <EmptyState
          icon={<SparkIcon className="size-5" />}
          title={d.ai.questionsNoVacancy}
          description={d.ai.questionsNoVacancyHint}
        />
      </Card>
    );
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
          title={d.ai.questionsTitle}
          description={d.ai.questionsDescription}
          action={
            <Button
              type="button"
              variant={result ? "secondary" : "primary"}
              size="sm"
              loading={pending}
              disabled={pending}
              onClick={generate}
              icon={
                result ? (
                  <RefreshIcon className="size-4" />
                ) : (
                  <SparkIcon className="size-4" />
                )
              }
            >
              {result ? d.ai.questionsRegenerate : d.ai.questionsGenerate}
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
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : null}

          {!pending && failure ? (
            <AiFailureNotice
              reason={failure.reason}
              message={failure.message}
            />
          ) : null}

          {!pending && !failure && !result ? (
            <EmptyState
              title={d.ai.questionsEmpty}
              description={d.ai.questionsEmptyHint}
            />
          ) : null}

          {!pending && result && result.questions.length === 0 ? (
            <EmptyState
              title={d.ai.questionsNone}
              description={d.ai.questionsNoneHint}
            />
          ) : null}

          {!pending && result && result.questions.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-ink-subtle">
                  {LOCALE_META[result.locale].label}
                </span>
                {result.model ? (
                  <span className="ml-auto text-[11.5px] text-ink-subtle">
                    {d.ai.model}: {result.model}
                  </span>
                ) : null}
              </div>

              <ol className="flex flex-col gap-3">
                {result.questions.map((question, index) => (
                  <li
                    key={question.id}
                    className="min-w-0 rounded-lg border border-line bg-surface-muted/40 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-[13.5px] font-medium leading-relaxed text-ink">
                        <span className="mr-1.5 tabular-nums text-ink-subtle">
                          {index + 1}.
                        </span>
                        {question.question}
                      </p>
                      <Badge
                        tone={
                          question.kind === "missing_requirement_probe"
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {d.status.questionKind[question.kind]}
                      </Badge>
                    </div>

                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
                      <span className="font-semibold">
                        {d.ai.questionReason}:{" "}
                      </span>
                      {question.reason}
                    </p>

                    {question.citations.length > 0 ? (
                      <CitationList
                        citations={question.citations}
                        onSelectCitation={onSelectCitation}
                        activeCitationId={activeCitationId}
                        className="mt-2.5 border-t border-line pt-2.5"
                      />
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
