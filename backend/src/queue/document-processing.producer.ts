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
   */
  async enqueueDocument(data: ProcessDocumentJobData): Promise<string | null> {
    const job = await this.queue.add(PROCESS_DOCUMENT_JOB, data, {
      // Deduplicates re-uploads of the same document within the retention window.
      jobId: `document:${data.documentId}`,
    });
    this.logger.log(`Enqueued ${PROCESS_DOCUMENT_JOB} for document ${data.documentId}`);
    return job.id ?? null;
  }

  /** Resolves once the queue's Redis connection is usable. Used by tests. */
  async isReachable(): Promise<boolean> {
    await this.queue.waitUntilReady();
    return true;
  }
}
