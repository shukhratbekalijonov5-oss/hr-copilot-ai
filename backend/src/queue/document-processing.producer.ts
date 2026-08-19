import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PROCESS_DOCUMENT_JOB,
  RESUME_PROCESSING_QUEUE,
  type ProcessDocumentJobData,
} from './queue.constants';

@Injectable()
export class DocumentProcessingProducer {
  private readonly logger = new Logger(DocumentProcessingProducer.name);

  constructor(
    @InjectQueue(RESUME_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessDocumentJobData>,
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

  /** Resolves once the queue's Redis connection is usable. Used by tests. */
  async isReachable(): Promise<boolean> {
    await this.queue.waitUntilReady();
    return true;
  }
}
