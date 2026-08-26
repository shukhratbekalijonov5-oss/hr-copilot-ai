"use client";

import { MatchDimensions } from "@/components/match/MatchDimensions";
import { MatchInsightSummary } from "@/components/match/MatchInsightSummary";
import { RequirementMatrix } from "@/components/match/RequirementMatrix";
import {
  ImprovementSuggestions,
  MatchContradictions,
  MatchScoreChangeSection,
  MatchTrajectory,
  TransferableSkills,
} from "@/components/match/MatchInsightSections";
import type { MatchInsight } from "@/lib/match/insight";

/**
 * The whole advanced analysis for one candidate/vacancy pair.
 *
 * One component for BOTH audiences, because the analysis is the same analysis
 * — the backend computes it from the same engine and strips the candidate's
 * private preferences for the HR context before it ever reaches a browser.
 * Keeping one panel means a wording fix lands on both surfaces at once, and
 * makes it impossible for the HR view to drift into showing something the
 * candidate view does not.
 *
 * `showImprovements` is the single audience difference: "what would improve
 * this match?" is advice for the person being matched, and would read as a
 * coaching note about a candidate if a recruiter saw it.
 *
 * Sections order from the general to the specific: headline, breakdown, the
 * requirement-by-requirement matrix, then the qualifiers. Each hides itself
 * when empty, so a thin-evidence match collapses to a short panel rather than
 * a page of headings with nothing under them.
 */
export function MatchInsightPanel({
  score,
  band,
  insight,
  showImprovements = false,
}: {
  score: number;
  band: string;
  insight: MatchInsight;
  showImprovements?: boolean;
}) {
  return (
    <div className="mt-3">
      <MatchInsightSummary score={score} band={band} insight={insight} />
      <MatchScoreChangeSection scoreChange={insight.scoreChange} />
      <MatchDimensions dimensions={insight.dimensions} />
      <RequirementMatrix rows={insight.requirementMatrix} />
      <TransferableSkills skills={insight.transferableSkills} />
      <MatchContradictions contradictions={insight.contradictions} />
      <MatchTrajectory trajectory={insight.careerTrajectory} />
      {showImprovements ? (
        <ImprovementSuggestions suggestions={insight.improvementSuggestions} />
      ) : null}
    </div>
  );
}
