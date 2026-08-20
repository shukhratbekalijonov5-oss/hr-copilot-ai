/** Queue and job names shared by the producer, the processor and tests. */
export const RESUME_PROCESSING_QUEUE = 'resume-processing';
export const PROCESS_DOCUMENT_JOB = 'PROCESS_DOCUMENT';
/** Personal (candidate-owned) resume → candidate-scoped AI index. */
export const PROCESS_PERSONAL_RESUME_JOB = 'PROCESS_PERSONAL_RESUME';
/** Remove a replaced personal resume's vectors. */
export const DELETE_PERSONAL_RESUME_INDEX_JOB = 'DELETE_PERSONAL_RESUME_INDEX';
/** Reconcile one vacancy with the candidate-discoverable index. */
export const SYNC_VACANCY_INDEX_JOB = 'SYNC_VACANCY_INDEX';

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

export interface PersonalResumeJobData {
  documentId: string;
  candidateAccountId: string;
}

/**
 * Intentionally just the id: the worker re-reads the vacancy and decides
 * whether to index (OPEN) or remove it (anything else, including deleted),
 * which makes the sync idempotent and safe to fire on every mutation.
 */
export interface SyncVacancyIndexJobData {
  vacancyId: string;
}

export type ResumeQueueJobData =
  ProcessDocumentJobData | PersonalResumeJobData | SyncVacancyIndexJobData;

/** Progress checkpoints reported back to ProcessingJob.progress. */
export const PROCESSING_PROGRESS = {
  QUEUED: 0,
  PARSING: 10,
  CHUNKING: 40,
  EMBEDDING: 60,
  INDEXING: 85,
  COMPLETED: 100,
} as const;
