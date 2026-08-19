import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import {
  PROCESSING_PROGRESS,
  RESUME_PROCESSING_QUEUE,
  type ProcessDocumentJobData,
} from './queue.constants';
import { ProcessingService } from '../processing/processing.service';
import {
  AiServiceClient,
  AiServiceDisabledError,
} from '../ai/ai-service.client';
import { DocumentStatus } from '../generated/prisma/enums';

/**
 * Drives one document through the processing lifecycle.
 *
 * The AI work itself lives behind AiServiceClient. While that service is not
 * configured the job fails fast with an UnrecoverableError — it does NOT retry
 * pointlessly and, crucially, does NOT mark the document COMPLETED. A document
 * only reaches COMPLETED after the AI service has really returned a parse.
 */
@Processor(RESUME_PROCESSING_QUEUE, { concurrency: 2 })
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  constructor(
    private readonly processing: ProcessingService,
    private readonly ai: AiServiceClient,
  ) {
    super();
  }

  async process(job: Job<ProcessDocumentJobData>): Promise<void> {
    const { documentId } = job.data;
    const attempts = job.attemptsMade + 1;

    try {
      if (!this.ai.enabled) {
        // Honest stop, not a fake success.
        throw new UnrecoverableError(
          'AI service is not configured (AI_SERVICE_URL is unset); document ' +
            'parsing cannot run yet',
        );
      }

      await this.processing.advance(
        documentId,
        DocumentStatus.PARSING,
        PROCESSING_PROGRESS.PARSING,
        attempts,
      );
      const parsed = await this.ai.parseDocument(documentId);
      await job.updateProgress(PROCESSING_PROGRESS.PARSING);

      await this.processing.advance(
        documentId,
        DocumentStatus.CHUNKING,
        PROCESSING_PROGRESS.CHUNKING,
        attempts,
      );
      await job.updateProgress(PROCESSING_PROGRESS.CHUNKING);

      await this.processing.advance(
        documentId,
        DocumentStatus.EMBEDDING,
        PROCESSING_PROGRESS.EMBEDDING,
        attempts,
      );
      await this.ai.generateEmbeddings(documentId);
      await job.updateProgress(PROCESSING_PROGRESS.EMBEDDING);

      await this.processing.advance(
        documentId,
        DocumentStatus.INDEXING,
        PROCESSING_PROGRESS.INDEXING,
        attempts,
      );
      await job.updateProgress(PROCESSING_PROGRESS.INDEXING);

      await this.processing.markCompleted(documentId, parsed.pageCount);
      await job.updateProgress(PROCESSING_PROGRESS.COMPLETED);
      this.logger.log(`Document ${documentId} processed`);
    } catch (error) {
      const message =
        error instanceof AiServiceDisabledError || error instanceof Error
          ? error.message
          : 'Unknown processing error';

      await this.processing.markFailed(documentId, message, attempts);
      throw error;
    }
  }
}
