"use client";

import { MatchInsightSummary } from "@/components/match/MatchInsightSummary";
import { MatchDimensions } from "@/components/match/MatchDimensions";
import {
  MatchContradictions,
  MatchScoreChangeSection,
  MatchTrajectory,
} from "@/components/match/MatchInsightSections";
import { Card } from "@/components/ui/Card";
import { Badge, Chip } from "@/components/ui/Badge";
import { SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { AiFailureReason } from "@/lib/types";
import type { HrMatchInsight } from "@/lib/match/hr-insight";

/**
 * The recruiter's headline read on this candidate, for the ACTIVE vacancy.
 *
 * ## Why this lives in Overview
 *
 * "Is this person worth my time on this role?" is the first question a
 * recruiter has, and it was answerable only after opening a second tab. The
 * decision-support signals — score, eligibility, confidence, where the points
 * came from, what is strong and what is thin — now sit at the top of Overview,
 * where they are read before anything else.
 *
 * ## What deliberately is NOT here
 *
 * The requirement matrix and its citations stay in JD Evidence. They are the
 * proof, and proof is a different activity from triage: a recruiter scanning
 * twenty applicants wants five numbers, not sixty evidence snippets. Splitting
 * them also means neither tab renders the same section twice.
 *
 * Improvement suggestions stay candidate-only, as everywhere else.
 */
export function HrMatchSummaryCard({
  insight,
  failure,
  vacancyTitle,
}: {
  insight: HrMatchInsight | null;
  failure: AiFailureReason | null;
  vacancyTitle: string;
}) {
  const { d } = useI18n();

  // No assessment and no error: the pair simply has none, so Overview carries
  // on without an empty card in front of the profile.
  if (!insight && !failure) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-ink">
          <SparkIcon className="size-4 text-ai-ink" aria-hidden />
          {d.matchInsight.overallMatch}
        </h3>
        {/* Names the vacancy these numbers describe. */}
        <Chip>{vacancyTitle}</Chip>
      </div>

      <div className="px-4 py-3">
        {failure ? (
          /*
           * Restrained on purpose: the assessment is one card on a page full
           * of independently useful information, so its absence is a line of
           * text rather than something that takes the profile down with it.
           */
          <p role="status" className="text-[13px] text-ink-muted">
            {d.matchInsight.unavailable}
          </p>
        ) : null}

        {insight ? (
          <>
            <MatchInsightSummary
              score={insight.score}
              band={insight.band}
              insight={insight.insight}
            />
            <MatchScoreChangeSection scoreChange={insight.insight.scoreChange} />
            <MatchDimensions dimensions={insight.insight.dimensions} />
            <StrengthsAndGaps
              strengths={insight.matchedSkills}
              gaps={insight.missingSkills}
            />
            {/*
              Contradictions and trajectory are recruiter-level signals rather
              than per-requirement proof, so they belong to the triage read and
              are not repeated in JD Evidence.
            */}
            <MatchContradictions contradictions={insight.insight.contradictions} />
            <MatchTrajectory trajectory={insight.insight.careerTrajectory} />
          </>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * A compact read of what the documents support and what they do not.
 *
 * Chips rather than sentences: at this size the recruiter is scanning, and the
 * per-requirement reasoning is one tab away. The gap list is neutral-toned and
 * headed "Missing or weaker evidence" — it describes the documents on file,
 * never the person's ability.
 */
function StrengthsAndGaps({
  strengths,
  gaps,
}: {
  strengths: string[];
  gaps: string[];
}) {
  const { d } = useI18n();
  if (strengths.length === 0 && gaps.length === 0) return null;

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {strengths.length > 0 ? (
        <section aria-labelledby="hr-strengths">
          <h4
            id="hr-strengths"
            className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink"
          >
            <Badge tone="positive">
              <span aria-hidden>✓</span>
              {strengths.length}
            </Badge>
            {d.matchInsight.strengths}
          </h4>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {strengths.map((skill) => (
              <Chip key={skill}>{skill}</Chip>
            ))}
          </div>
        </section>
      ) : null}

      {gaps.length > 0 ? (
        <section aria-labelledby="hr-gaps">
          <h4
            id="hr-gaps"
            className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink"
          >
            <Badge tone="neutral">
              <span aria-hidden>—</span>
              {gaps.length}
            </Badge>
            {d.matchInsight.gaps}
          </h4>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {gaps.map((skill) => (
              <Chip key={skill}>{skill}</Chip>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
