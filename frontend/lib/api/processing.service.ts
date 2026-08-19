import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import { summarizeDocumentStatuses, toProcessingJob } from "@/lib/api/adapters";
import { getAllDocuments } from "@/lib/api/documents.service";
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
export async function getProcessingJobs(
  query: { status?: ProcessingJobStatus; page?: number; limit?: number } = {},
): Promise<{ jobs: ProcessingJob[]; total: number }> {
  const [response, documents, candidates] = await Promise.all([
    apiFetch<Paginated<ProcessingJobResponse>>("/processing-jobs", {
      query: {
        page: query.page ?? 1,
        limit: query.limit ?? 100,
        status: query.status,
      },
    }),
    getAllDocuments(),
    getAllCandidates(),
  ]);

  const candidateByDocument = new Map<string, { id: string; fullName: string }>();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));

  for (const document of documents) {
    if (!document.candidateId) continue;
    const candidate = candidateById.get(document.candidateId);
    if (candidate) {
      candidateByDocument.set(document.id, {
        id: candidate.id,
        fullName: candidate.fullName,
      });
    }
  }

  return {
    jobs: response.data.map((job) =>
      toProcessingJob(job, candidateByDocument.get(job.documentId) ?? null),
    ),
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

/** Pipeline readout across every document in the organization. */
export async function getProcessingSummary(): Promise<ProcessingSummary> {
  const documents = await getAllDocuments();
  return summarizeDocumentStatuses(documents.map((d) => d.status));
}
