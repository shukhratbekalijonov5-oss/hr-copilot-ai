"use client";

import { ProgressBar } from "@/components/ui/ProgressBar";
import { useI18n } from "@/lib/i18n/context";
import { PIPELINE_STAGES } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ProcessingSummary } from "@/lib/types";

interface ProcessingProgressProps {
  summary: ProcessingSummary;
  className?: string;
  /** Hides the per-stage rows, leaving only the headline counts. */
  compact?: boolean;
}

/**
 * Cumulative pipeline readout: each row is "documents that have reached at
 * least this stage", which is how the worker reports progress.
 */
export function ProcessingProgress({
  summary,
  className,
  compact = false,
}: ProcessingProgressProps) {
  const { d, f } = useI18n();
  const { total, failed, reached } = summary;

  if (total === 0) {
    return (
      <p className={cn("text-[13px] text-ink-muted", className)}>
        {d.processing.queueEmptyShort}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {(compact ? PIPELINE_STAGES.slice(0, 1) : PIPELINE_STAGES).map((stage) => (
        <div key={stage} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-[12.5px] font-medium text-ink-muted">
            {d.status.pipeline[stage]}
          </span>
          <ProgressBar
            value={reached[stage]}
            max={total}
            tone={stage === "COMPLETED" ? "positive" : "brand"}
            label={`${d.status.pipeline[stage]} ${reached[stage]} of ${total}`}
            className="flex-1"
          />
          <span className="w-16 shrink-0 text-right text-[12.5px] tabular-nums text-ink-muted">
            {reached[stage]} / {total}
          </span>
        </div>
      ))}

      {failed > 0 ? (
        <div className="flex items-center gap-3 border-t border-line pt-2.5">
          <span className="w-20 shrink-0 text-[12.5px] font-medium text-critical">
            {d.processing.failed}
          </span>
          <ProgressBar
            value={failed}
            max={total}
            tone="critical"
            label={f(d.processing.stageLabel, {
              stage: d.processing.failed,
              reached: failed,
              total,
            })}
            className="flex-1"
          />
          <span className="w-16 shrink-0 text-right text-[12.5px] tabular-nums text-critical">
            {failed}
          </span>
        </div>
      ) : null}
    </div>
  );
}
