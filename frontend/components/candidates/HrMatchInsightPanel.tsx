"use client";

import { MatchInsightPanel } from "@/components/match/MatchInsightPanel";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { AiFailureReason } from "@/lib/types";
import type { HrMatchInsight } from "@/lib/match/hr-insight";

/**
 * The advanced assessment of this applicant against the ACTIVE vacancy.
 *
 * ## Read on the server, not behind a button
 *
 * This panel used to fetch on click, on the assumption that an assessment was
 * expensive enough to owe the reader an explicit request. That was wrong about
 * this endpoint: it is a sub-second deterministic read with no model in the
 * path. Gating it meant a recruiter opening the tab saw a heading and a
 * button where the analysis should be, and the request never fired at all
 * unless they guessed to press it. The parent now reads it server-side and
 * passes it in, so the score, eligibility and confidence are in the first
 * paint.
 *
 * ## Vacancy context is the whole point
 *
 * The parent mounts this with `key={vacancyId}`, and the insight it receives
 * was fetched for that same vacancy in the same render. There is no path by
 * which vacancy A's assessment can appear under vacancy B's heading.
 *
 * ## Improvement suggestions are not shown here
 *
 * They are advice addressed to the candidate. On a recruiter's screen they
 * would read as a private note about the person rather than a to-do list the
 * person owns, so `showImprovements` is left off for this audience.
 */
export function HrMatchInsightPanel({
  insight,
  failure,
  vacancyTitle,
}: {
  insight: HrMatchInsight | null;
  failure: AiFailureReason | null;
  vacancyTitle: string;
}) {
  const { d } = useI18n();

  // Nothing to say and nothing went wrong: the pair has no assessment, so the
  // legacy evidence below stands on its own rather than under an empty card.
  if (!insight && !failure) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-ink">
          <SparkIcon className="size-4 text-ai-ink" aria-hidden />
          {d.matchInsight.overallMatch}
        </h3>
        {/* Names the vacancy the numbers describe, so a screenshot is unambiguous. */}
        <Chip>{vacancyTitle}</Chip>
      </div>

      {failure ? (
        <p role="alert" className="mt-3 text-[13px] text-critical">
          {d.ai.retrievalUnavailable}
        </p>
      ) : null}

      {insight ? (
        <MatchInsightPanel
          score={insight.score}
          band={insight.band}
          insight={insight.insight}
        />
      ) : null}
    </Card>
  );
}
