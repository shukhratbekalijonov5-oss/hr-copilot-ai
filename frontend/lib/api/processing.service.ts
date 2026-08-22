import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import { summarizeDocumentStatuses, toProcessingJob } from "@/lib/api/adapters";
import { getAllCandidates } from "@/lib/api/candidates.service";
import type { ProcessingJobResponse } from "@/lib/api/contracts";
import type {
  ProcessingJob,
  ProcessingJobStatus,
  ProcessingSummary,
} from "@/lib/types";

/**
 * Processing jobs, enriched with the candidate each document belongs to.
 *
 * The API's job payload nests only the document, so the candidate name is
 * resolved here rather than in the table component.
 */
/**
 * `vacancyId` filters to jobs whose DOCUMENT belongs to a candidate in that
 * owned vacancy. Processing stays document-centric: one document is one job
 * shared by every vacancy its candidate joins, so the filter selects rows —
 * it never duplicates them per vacancy.
 */
export async function getProcessingJobs(
  query: {
    status?: ProcessingJobStatus;
    vacancyId?: string;
    page?: number;
    limit?: number;
  } = {},
): Promise<{ jobs: ProcessingJob[]; total: number }> {
  // One request: the API resolves each job's document AND its candidate in
  // the same query. There is no org-wide document list to join against any
  // more — since the snapshot removal, candidate evidence lives only on the
  // candidate account and is never copied into the organization.
  const response = await apiFetch<Paginated<ProcessingJobResponse>>(
    "/processing-jobs",
    {
      query: {
        page: query.page ?? 1,
        limit: query.limit ?? 100,
        status: query.status,
        vacancyId: query.vacancyId,
      },
    },
  );

  return {
    jobs: response.data.map((job) => toProcessingJob(job)),
    total: response.meta.total,
  };
}

export async function getProcessingJob(id: string): Promise<ProcessingJob> {
  return toProcessingJob(
    await apiFetch<ProcessingJobResponse>(`/processing-jobs/${id}`),
  );
}

export async function getAllProcessingJobs(): Promise<ProcessingJob[]> {
  const rows = await fetchAllPages<ProcessingJobResponse>("/processing-jobs");
  return rows.map((job) => toProcessingJob(job));
}

/**
 * Pipeline readout across the applicants' CURRENT documents.
 *
 * These are the files the organization's AI actually reads. Organization-side
 * copies no longer exist, so summarising them would report an empty pipeline
 * while every applicant's resume was being processed normally.
 */
export async function getProcessingSummary(): Promise<ProcessingSummary> {
  const candidates = await getAllCandidates();
  return summarizeDocumentStatuses(
    candidates.flatMap((candidate) => candidate.documentStatuses),
  );
}
