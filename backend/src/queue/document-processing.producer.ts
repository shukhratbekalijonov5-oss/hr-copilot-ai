import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  DELETE_APPLICATION_LINK_INDEX_JOB,
  DELETE_CANDIDATE_LINK_INDEX_JOB,
  DELETE_PERSONAL_RESUME_INDEX_JOB,
  PROCESS_APPLICATION_LINK_JOB,
  PROCESS_CANDIDATE_LINK_JOB,
  PROCESS_DOCUMENT_JOB,
  PROCESS_PERSONAL_RESUME_JOB,
  RESUME_PROCESSING_QUEUE,
  SYNC_VACANCY_INDEX_JOB,
  type ApplicationLinkJobData,
  type CandidateLinkJobData,
  type PersonalResumeJobData,
  type ProcessDocumentJobData,
  type ResumeQueueJobData,
  type SyncVacancyIndexJobData,
} from './queue.constants';

@Injectable()
export class DocumentProcessingProducer {
  private readonly logger = new Logger(DocumentProcessingProducer.name);

  constructor(
    @InjectQueue(RESUME_PROCESSING_QUEUE)
    private readonly queue: Queue<ResumeQueueJobData>,
  ) {}

  /**
   * Enqueues a document for asynchronous processing and returns the BullMQ job
   * id so the caller can persist it on the ProcessingJob row.
   *
   * The HTTP handler returns as soon as this resolves — no parsing, embedding
   * or any other AI work happens on the request thread.
   *
   * @param replaceExisting deliberately requeue a document that already has a
   *   job under this id. The reprocess path needs it: BullMQ treats `add` with
   *   an existing jobId as a no-op and hands back the old job, so a retry
   *   after a failure would enqueue nothing and sit in QUEUED forever.
   */
  async enqueueDocument(
    data: ProcessDocumentJobData,
    { replaceExisting = false }: { replaceExisting?: boolean } = {},
  ): Promise<string | null> {
    // Deduplicates re-uploads of the same document within the retention
    // window. BullMQ rejects ':' in a custom job id (it is the delimiter in
    // its own Redis key names), so use a hyphen.
    const jobId = `document-${data.documentId}`;

    if (replaceExisting) {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        // Only a finished job may be discarded. An active or queued one is
        // still real pending work and must not be pulled out from under a
        // worker.
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          this.logger.warn(
            `Document ${data.documentId} already has a ${state} job; not requeuing`,
          );
          return existing.id ?? null;
        }
        await existing.remove();
      }
    }

    const job = await this.queue.add(PROCESS_DOCUMENT_JOB, data, { jobId });
    this.logger.log(
      `Enqueued ${PROCESS_DOCUMENT_JOB} for document ${data.documentId}`,
    );
    return job.id ?? null;
  }

  /**
   * True when a job for this document is genuinely still pending or running.
   *
   * A document row can be left in an in-flight status with no live job behind
   * it — a worker died, or an enqueue silently no-opped. Trusting the row
   * alone would strand such a document forever, so the recovery path asks the
   * queue what is actually there.
   */
  async hasLiveJob(documentId: string): Promise<boolean> {
    const job = await this.queue.getJob(`document-${documentId}`);
    if (!job) return false;
    const state = await job.getState();
    return state === 'active' || state === 'waiting' || state === 'delayed';
  }

  /**
   * Enqueues a PERSONAL resume for candidate-scoped AI indexing.
   *
   * Distinct job id namespace from org documents so a personal doc can never
   * dedupe against an org one. Replace semantics on the AI side make retries
   * and re-uploads idempotent.
   */
  async enqueuePersonalResume(
    data: PersonalResumeJobData,
  ): Promise<string | null> {
    const job = await this.queue.add(PROCESS_PERSONAL_RESUME_JOB, data, {
      jobId: `personal-${data.documentId}`,
    });
    this.logger.log(
      `Enqueued ${PROCESS_PERSONAL_RESUME_JOB} for document ${data.documentId}`,
    );
    return job.id ?? null;
  }

  /** Queues removal of a replaced personal resume's vectors. */
  async enqueuePersonalResumeIndexDeletion(
    data: PersonalResumeJobData,
  ): Promise<string | null> {
    const job = await this.queue.add(DELETE_PERSONAL_RESUME_INDEX_JOB, data, {
      jobId: `personal-delete-${data.documentId}`,
    });
    return job.id ?? null;
  }

  /**
   * Queues a vacancy ↔ index reconciliation. Fired on every vacancy mutation;
   * the worker looks at the CURRENT database state, so firing it many times
   * (or after deletion) converges on the right index contents. A fresh job id
   * per call is deliberate: a later mutation must not be swallowed by
   * deduping against a finished earlier job.
   */
  async enqueueVacancyIndexSync(
    data: SyncVacancyIndexJobData,
  ): Promise<string | null> {
    const job = await this.queue.add(SYNC_VACANCY_INDEX_JOB, data);
    return job.id ?? null;
  }

  /**
   * Queues a PERSONAL link for fetching and candidate-scoped indexing.
   *
   * Own job-id namespace (`link-`) so a link can never dedupe against a
   * document. `replaceExisting` backs the candidate-facing "Retry" and
   * "Refresh" actions: BullMQ treats `add` with an existing id as a no-op, so
   * without it a retry after a failure would silently enqueue nothing.
   */
  async enqueueCandidateLink(
    data: CandidateLinkJobData,
    { replaceExisting = false }: { replaceExisting?: boolean } = {},
  ): Promise<string | null> {
    const jobId = `link-${data.linkId}`;
    if (replaceExisting) {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          this.logger.warn(
            `Link ${data.linkId} already has a ${state} job; not requeuing`,
          );
          return existing.id ?? null;
        }
        await existing.remove();
      }
    }
    const job = await this.queue.add(PROCESS_CANDIDATE_LINK_JOB, data, {
      jobId,
    });
    return job.id ?? null;
  }

  /** True when a fetch job for this link is genuinely still pending/running. */
  async hasLiveLinkJob(linkId: string): Promise<boolean> {
    const job = await this.queue.getJob(`link-${linkId}`);
    if (!job) return false;
    const state = await job.getState();
    return state === 'active' || state === 'waiting' || state === 'delayed';
  }

  /** Queues removal of a deleted personal link's vectors. */
  async enqueueCandidateLinkIndexDeletion(
    data: CandidateLinkJobData,
  ): Promise<string | null> {
    const job = await this.queue.add(DELETE_CANDIDATE_LINK_INDEX_JOB, data, {
      jobId: `link-delete-${data.linkId}`,
    });
    return job.id ?? null;
  }

  /** Queues indexing of one org-scoped application link snapshot. */
  async enqueueApplicationLink(
    data: ApplicationLinkJobData,
  ): Promise<string | null> {
    const job = await this.queue.add(PROCESS_APPLICATION_LINK_JOB, data, {
      jobId: `app-link-${data.linkSourceId}`,
    });
    return job.id ?? null;
  }

  /** Queues removal of a deleted application link snapshot's vectors. */
  async enqueueApplicationLinkIndexDeletion(
    data: ApplicationLinkJobData,
  ): Promise<string | null> {
    const job = await this.queue.add(DELETE_APPLICATION_LINK_INDEX_JOB, data, {
      jobId: `app-link-delete-${data.linkSourceId}`,
    });
    return job.id ?? null;
  }

  /** Resolves once the queue's Redis connection is usable. Used by tests. */
  async isReachable(): Promise<boolean> {
    await this.queue.waitUntilReady();
    return true;
  }
}
