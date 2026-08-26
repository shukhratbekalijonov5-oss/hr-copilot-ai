"use client";

import { useState, useTransition } from "react";
import { runMatchInsightAction } from "@/app/(app)/candidates/[id]/actions";
import { MatchInsightPanel } from "@/components/match/MatchInsightPanel";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { HrMatchInsight } from "@/lib/match/hr-insight";

/**
 * The advanced assessment of this applicant against the ACTIVE vacancy.
 *
 * ## Vacancy context is the whole point
 *
 * The panel is mounted with `key={vacancyId}` by its parent, so switching the
 * vacancy selector throws this component away along with whatever it had
 * loaded. There is no path by which vacancy A's assessment can still be on
 * screen while the header says vacancy B — the state simply does not survive
 * the switch.
 *
 * ## Computed on request
 *
 * A recruiter opening a profile has not asked for a ranking pass, so nothing
 * runs until the button is pressed. The same reasoning as the premium AI
 * tools: paid, slow work belongs behind an explicit action.
 *
 * ## Improvement suggestions are not shown here
 *
 * They are advice addressed to the candidate. Rendered on a recruiter's
 * screen they would read as a private note about the person rather than a
 * to-do list the person owns, so the panel omits them for this audience.
 */
export function HrMatchInsightPanel({
  candidateId,
  vacancyId,
  vacancyTitle,
}: {
  candidateId: string;
  vacancyId: string;
  vacancyTitle: string;
}) {
  const { d } = useI18n();
  const [result, setResult] = useState<HrMatchInsight | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    setFailed(false);
    startTransition(async () => {
      const outcome = await runMatchInsightAction(candidateId, vacancyId);
      if (outcome.ok) setResult(outcome.data);
      else setFailed(true);
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-ink">
            <SparkIcon className="size-4 text-ai-ink" aria-hidden />
            {d.matchInsight.overallMatch}
          </h3>
          {/* Names the vacancy the numbers describe, so a screenshot is unambiguous. */}
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            <Chip>{vacancyTitle}</Chip>
          </p>
        </div>
        {result ? null : (
          <Button variant="secondary" size="sm" onClick={run} disabled={pending}>
            {pending ? d.common.loading : d.matchInsight.scoreBreakdown}
          </Button>
        )}
      </div>

      {failed ? (
        <p role="alert" className="mt-3 text-[13px] text-critical">
          {d.ai.retrievalUnavailable}
        </p>
      ) : null}

      {result ? (
        <MatchInsightPanel
          score={result.score}
          band={result.band}
          insight={result.insight}
        />
      ) : null}
    </Card>
  );
}
