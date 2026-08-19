/** Queue and job names shared by the producer, the processor and tests. */
export const RESUME_PROCESSING_QUEUE = 'resume-processing';
export const PROCESS_DOCUMENT_JOB = 'PROCESS_DOCUMENT';

/**
 * Job payloads carry identifiers only — never file contents, buffers, signed
 * URLs or anything derived from a secret. The worker re-reads whatever it
 * needs from Postgres and object storage using these ids.
 */
export interface ProcessDocumentJobData {
  documentId: string;
  organizationId: string;
  candidateId: string | null;
}

/** Progress checkpoints reported back to ProcessingJob.progress. */
export const PROCESSING_PROGRESS = {
  QUEUED: 0,
  PARSING: 10,
  CHUNKING: 40,
  EMBEDDING: 60,
  INDEXING: 85,
  COMPLETED: 100,
} as const;
