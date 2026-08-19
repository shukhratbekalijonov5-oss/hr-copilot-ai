import type {
  PipelineStage,
  ProcessingStatus,
  ProcessingSummary,
} from "@/lib/types";
import { PIPELINE_STAGES } from "@/lib/types";

/** Minimal class-name joiner — avoids pulling in clsx for a 6-line helper. */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(
  value: string,
  now: number = Date.now(),
): string {
  const diffMs = now - new Date(value).getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(value);
}

export function formatMonthYear(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export function formatDateRange(
  start: string,
  end: string | null,
): string {
  return `${formatMonthYear(start)} — ${end ? formatMonthYear(end) : "Present"}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** Where a status sits in the pipeline; -1 for statuses outside it. */
export function pipelineStageIndex(status: ProcessingStatus): number {
  return (PIPELINE_STAGES as readonly string[]).indexOf(status);
}

/**
 * Collapses per-document statuses into the cumulative "reached at least this
 * stage" counts the progress readout displays.
 */
export function summarizeProcessing(
  statuses: ProcessingStatus[],
): ProcessingSummary {
  const reached = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage, 0]),
  ) as Record<PipelineStage, number>;

  let failed = 0;

  for (const status of statuses) {
    if (status === "failed") {
      failed += 1;
      continue;
    }
    // A queued document has been uploaded but has not entered parsing yet.
    const index = status === "queued" ? 0 : pipelineStageIndex(status);
    if (index < 0) continue;

    for (let i = 0; i <= index; i += 1) {
      reached[PIPELINE_STAGES[i]] += 1;
    }
  }

  return { total: statuses.length, failed, reached };
}

/** Percentage of the pipeline a single document has completed. */
export function processingProgress(status: ProcessingStatus): number {
  if (status === "completed") return 100;
  if (status === "failed") return 0;
  if (status === "queued") return 8;
  const index = pipelineStageIndex(status);
  if (index < 0) return 0;
  return Math.round((index / (PIPELINE_STAGES.length - 1)) * 100);
}
