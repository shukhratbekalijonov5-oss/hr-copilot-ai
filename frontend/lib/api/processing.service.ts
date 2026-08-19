import { matchesSearch, mockRequest } from "@/lib/api/client";
import {
  documents,
  globalProcessingSummary,
  processingJobs,
} from "@/lib/mock/store";
import { PIPELINE_STAGES } from "@/lib/types";
import { summarizeProcessing } from "@/lib/utils";
import type {
  ProcessingJob,
  ProcessingStatus,
  ProcessingSummary,
  UploadItem,
} from "@/lib/types";

export interface ProcessingJobQuery {
  search?: string;
  status?: ProcessingStatus | "all";
  vacancyId?: string | "all";
}

export async function getProcessingJobs(
  query: ProcessingJobQuery = {},
): Promise<ProcessingJob[]> {
  return mockRequest(() => {
    const status = query.status ?? "all";
    const vacancyId = query.vacancyId ?? "all";

    return processingJobs
      .filter((job) => (status === "all" ? true : job.status === status))
      .filter((job) => (vacancyId === "all" ? true : job.vacancyId === vacancyId))
      .filter((job) =>
        matchesSearch(
          query.search ?? "",
          job.documentName,
          job.candidateName,
          job.vacancyTitle,
        ),
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  });
}

export async function getProcessingSummary(): Promise<ProcessingSummary> {
  return mockRequest(() => globalProcessingSummary);
}

export async function getDocumentStatuses(): Promise<ProcessingStatus[]> {
  return mockRequest(() => documents.map((document) => document.status), 0);
}

/* -------------------------------------------------------------------------- */
/* Upload + live progress                                                      */
/* -------------------------------------------------------------------------- */

export interface ProcessingEvent {
  uploadId: string;
  status: ProcessingStatus;
  progress: number;
  error: string | null;
}

/**
 * A live feed of pipeline events for a set of uploads.
 *
 * The mock drives it with timers. The real implementation opens a WebSocket to
 * the worker and forwards each message to `onEvent` — the component contract
 * does not change.
 */
export interface ProcessingChannel {
  close(): void;
}

export interface UploadRequest {
  files: File[];
  vacancyId?: string | null;
}

/** Registers uploads and returns the queue rows the UI renders. */
export async function uploadResumes(
  request: UploadRequest,
): Promise<UploadItem[]> {
  return mockRequest(
    () =>
      request.files.map((file, index) => ({
        id: `upl-${Date.now().toString(36)}-${index}`,
        fileName: file.name,
        sizeBytes: file.size,
        status: "uploaded" as ProcessingStatus,
        progress: 0,
        error: null,
      })),
    450,
  );
}

const STAGE_DURATION_MS: Record<string, [number, number]> = {
  uploaded: [400, 900],
  parsing: [900, 2200],
  chunking: [600, 1400],
  embedding: [1100, 2600],
  indexing: [700, 1600],
};

function randomBetween([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}

export function openProcessingChannel(
  items: Pick<UploadItem, "id">[],
  onEvent: (event: ProcessingEvent) => void,
): ProcessingChannel {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let closed = false;

  const advance = (uploadId: string, stageIndex: number) => {
    if (closed) return;

    const stage = PIPELINE_STAGES[stageIndex];
    const progress = Math.round(
      (stageIndex / (PIPELINE_STAGES.length - 1)) * 100,
    );

    // ~6% of documents fail during parsing, mirroring unreadable scans.
    if (stage === "parsing" && Math.random() < 0.06) {
      onEvent({
        uploadId,
        status: "failed",
        progress,
        error: "Could not extract text. The file may be a flat scan.",
      });
      return;
    }

    onEvent({ uploadId, status: stage, progress, error: null });

    if (stage === "completed") return;

    timers.push(
      setTimeout(
        () => advance(uploadId, stageIndex + 1),
        randomBetween(STAGE_DURATION_MS[stage] ?? [500, 1200]),
      ),
    );
  };

  items.forEach((item, index) => {
    // Stagger starts so the queue fills progressively rather than in lockstep.
    timers.push(setTimeout(() => advance(item.id, 0), index * 180));
  });

  return {
    close() {
      closed = true;
      timers.forEach(clearTimeout);
    },
  };
}

/** Cumulative stage counts for an in-browser upload queue. */
export function summarizeUploads(items: UploadItem[]): ProcessingSummary {
  return summarizeProcessing(items.map((item) => item.status));
}
