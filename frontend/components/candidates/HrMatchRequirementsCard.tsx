"use client";

import { RequirementMatrix } from "@/components/match/RequirementMatrix";
import { TransferableSkills } from "@/components/match/MatchInsightSections";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { HrMatchInsight } from "@/lib/match/hr-insight";

/**
 * The requirement-by-requirement proof, for the ACTIVE vacancy.
 *
 * The other half of the split: Overview answers "how strong is this
 * candidate?", this answers "on what basis?". It carries the matrix, each
 * row's citations, and the transferable evidence that covers a specific
 * requirement — everything that only makes sense while looking at a named
 * requirement.
 *
 * It sits above the legacy evidence map, which remains the source-document
 * view. The two are complementary rather than duplicated: the matrix is the
 * deterministic per-requirement verdict, the map below is the retrieval view
 * of the same documents.
 *
 * Nothing here repeats Overview — no score, no eligibility, no confidence, no
 * dimensions. A reader who wants those switches tab; a reader who wants proof
 * stays.
 */
export function HrMatchRequirementsCard({
  insight,
  vacancyTitle,
}: {
  insight: HrMatchInsight | null;
  vacancyTitle: string;
}) {
  const { d } = useI18n();

  // Only draws when there is something to prove. An assessment that produced
  // no matrix rows leaves the evidence map below to speak for itself.
  if (
    !insight ||
    (insight.insight.requirementMatrix.length === 0 &&
      insight.insight.transferableSkills.length === 0)
  ) {
    return null;
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-ink">
          <SparkIcon className="size-4 text-ai-ink" aria-hidden />
          {d.matchInsight.requirementMatrix}
        </h3>
        <Chip>{vacancyTitle}</Chip>
      </div>
      <div className="px-4 pb-3">
        <RequirementMatrix rows={insight.insight.requirementMatrix} />
        <TransferableSkills skills={insight.insight.transferableSkills} />
      </div>
    </Card>
  );
}
