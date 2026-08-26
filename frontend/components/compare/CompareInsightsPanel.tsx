"use client";

import { useState, useTransition } from "react";
import { compareInsightsAction } from "@/app/(app)/compare/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { eligibilityPresentation } from "@/lib/match/presentation";
import type { CompareInsights, CompareSuperlative } from "@/lib/match/hr-insight";

/**
 * Compare intelligence: four decided superlatives, then one compact row per
 * candidate.
 *
 * ## The winners are the backend's
 *
 * Each superlative arrives as a candidate plus the figure that decided it, and
 * both are rendered as given. Recomputing "who has the fewest gaps" here would
 * eventually disagree with the server over a tie-break, and the two answers
 * would sit on the same screen.
 *
 * ## Four numbers per candidate, not a matrix
 *
 * Score, eligibility, confidence and must-have gaps — the four a recruiter
 * shortlists on. The full requirement matrix stays on the candidate's own
 * detail page: repeating it for five people side by side is the unreadable
 * table §13 asks us not to build.
 *
 * ## An unassessed candidate is shown as unassessed
 *
 * `score: null` means the backend could not assess them (no evidence, not on
 * this vacancy, index pending). They keep their row and are labelled, rather
 * than being scored 0 and sorted to the bottom on merit never measured.
 */
export function CompareInsightsPanel({
  vacancyId,
  candidateIds,
}: {
  vacancyId: string;
  candidateIds: string[];
}) {
  const { d } = useI18n();
  const [result, setResult] = useState<CompareInsights | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  // Fewer than two candidates cannot be compared, and the backend refuses.
  if (candidateIds.length < 2) return null;

  function run() {
    setFailed(false);
    startTransition(async () => {
      const outcome = await compareInsightsAction(vacancyId, candidateIds);
      if (outcome.ok) setResult(outcome.data);
      else setFailed(true);
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-ink">
          <SparkIcon className="size-4 text-ai-ink" aria-hidden />
          {d.matchInsight.compareTitle}
        </h3>
        {result ? null : (
          <Button variant="secondary" size="sm" onClick={run} disabled={pending}>
            {pending ? d.common.loading : d.matchInsight.compareTitle}
          </Button>
        )}
      </div>

      {failed ? (
        <p role="alert" className="mt-3 text-[13px] text-critical">
          {d.ai.retrievalUnavailable}
        </p>
      ) : null}

      {result ? (
        <>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            <Superlative
              label={d.matchInsight.bestTechnicalMatch}
              value={result.superlatives.bestTechnicalMatch}
            />
            <Superlative
              label={d.matchInsight.bestSeniorityFit}
              value={result.superlatives.bestSeniorityFit}
            />
            <Superlative
              label={d.matchInsight.fewestMustHaveGaps}
              value={result.superlatives.fewestMustHaveGaps}
            />
            <Superlative
              label={d.matchInsight.highestEvidenceConfidence}
              value={result.superlatives.highestEvidenceConfidence}
            />
          </ul>

          <ul className="mt-3 flex flex-col divide-y divide-line border-t border-line">
            {result.candidates.map((candidate) => (
              <li
                key={candidate.candidateId}
                className="grid gap-1.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-3"
              >
                <span className="truncate text-[13px] font-medium text-ink">
                  {candidate.fullName}
                </span>

                {candidate.score === null ? (
                  <span className="text-[12px] text-ink-subtle sm:col-span-3">
                    {d.matchInsight.notAssessed}
                  </span>
                ) : (
                  <>
                    <span className="text-[12.5px] tabular-nums text-ink">
                      {candidate.score}
                      {candidate.band ? (
                        <span className="text-ink-muted"> — {candidate.band}</span>
                      ) : null}
                    </span>
                    {candidate.eligibility ? (
                      <EligibilityBadge eligibility={candidate.eligibility} />
                    ) : (
                      <span />
                    )}
                    <span className="text-[12px] text-ink-muted">
                      {candidate.evidenceConfidence !== null
                        ? `${d.matchInsight.evidenceConfidence} ${candidate.evidenceConfidence}%`
                        : null}
                      {candidate.mustHaveGapCount !== null
                        ? ` · ${d.matchInsight.hardGaps} ${candidate.mustHaveGapCount}`
                        : null}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function EligibilityBadge({
  eligibility,
}: {
  eligibility: NonNullable<CompareInsights["candidates"][number]["eligibility"]>;
}) {
  const { d } = useI18n();
  const presentation = eligibilityPresentation(eligibility);
  const label =
    eligibility === "ELIGIBLE"
      ? d.matchInsight.eligible
      : eligibility === "PARTIAL"
        ? d.matchInsight.eligibilityPartial
        : d.matchInsight.blocked;

  return (
    <Badge tone={presentation.tone}>
      <span aria-hidden>{presentation.glyph}</span>
      {label}
    </Badge>
  );
}

function Superlative({
  label,
  value,
}: {
  label: string;
  value: CompareSuperlative | null;
}) {
  const { d } = useI18n();
  return (
    <li className="rounded-lg border border-line bg-surface-muted/40 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      {value ? (
        <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
          <span className="text-[13px] font-medium text-ink">{value.fullName}</span>
          <span className="text-[12px] tabular-nums text-ink-muted">
            {value.value}
          </span>
        </p>
      ) : (
        /* Null means fewer than two candidates could be measured on this. */
        <p className="mt-0.5 text-[12px] text-ink-subtle">
          {d.matchInsight.notAssessed}
        </p>
      )}
    </li>
  );
}
