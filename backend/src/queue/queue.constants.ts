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
 * PERSONAL professional link → fetch the page, extract evidence, index it into
 * the candidate-scoped collection. The network fetch is the reason this is a
 * queue job and not request work: it can take tens of seconds and fail.
 */
export const PROCESS_CANDIDATE_LINK_JOB = 'PROCESS_CANDIDATE_LINK';
/** Remove a deleted/replaced personal link's vectors. */
export const DELETE_CANDIDATE_LINK_INDEX_JOB = 'DELETE_CANDIDATE_LINK_INDEX';
/**
 * ORG-scoped application link snapshot → index into the tenant collection.
 * Deliberately does NOT fetch anything: the content was frozen at apply time
 * and re-fetching would break snapshot immutability.
 */
export const PROCESS_APPLICATION_LINK_JOB = 'PROCESS_APPLICATION_LINK';
/** Remove a deleted application link snapshot's vectors. */
export const DELETE_APPLICATION_LINK_INDEX_JOB =
  'DELETE_APPLICATION_LINK_INDEX';

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

export interface CandidateLinkJobData {
  linkId: string;
  candidateAccountId: string;
}

export interface ApplicationLinkJobData {
  linkSourceId: string;
  organizationId: string;
  candidateId: string;
}

export type ResumeQueueJobData =
  | ProcessDocumentJobData
  | PersonalResumeJobData
  | SyncVacancyIndexJobData
  | CandidateLinkJobData
  | ApplicationLinkJobData;

/** Progress checkpoints reported back to ProcessingJob.progress. */
export const PROCESSING_PROGRESS = {
  QUEUED: 0,
  PARSING: 10,
  CHUNKING: 40,
  EMBEDDING: 60,
  INDEXING: 85,
  COMPLETED: 100,
} as const;
