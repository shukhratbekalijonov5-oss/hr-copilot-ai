import { ProgressBar } from "@/components/ui/ProgressBar";
import { PIPELINE_STAGE_LABELS } from "@/lib/constants";
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
  const { total, failed, reached } = summary;

  if (total === 0) {
    return (
      <p className={cn("text-[13px] text-ink-muted", className)}>
        Nothing in the processing queue.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {(compact ? PIPELINE_STAGES.slice(0, 1) : PIPELINE_STAGES).map((stage) => (
        <div key={stage} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-[12.5px] font-medium text-ink-muted">
            {PIPELINE_STAGE_LABELS[stage]}
          </span>
          <ProgressBar
            value={reached[stage]}
            max={total}
            tone={stage === "completed" ? "positive" : "brand"}
            label={`${PIPELINE_STAGE_LABELS[stage]} ${reached[stage]} of ${total}`}
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
            Failed
          </span>
          <ProgressBar
            value={failed}
            max={total}
            tone="critical"
            label={`Failed ${failed} of ${total}`}
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
