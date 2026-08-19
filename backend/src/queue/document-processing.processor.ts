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
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentStatus } from '../generated/prisma/enums';

/**
 * Drives one document through the processing lifecycle.
 *
 * Division of responsibility:
 *   - This worker owns orchestration and the terminal states (COMPLETED /
 *     FAILED). It is the source of truth for whether the job succeeded.
 *   - The AI service owns the intermediate stages, and reports each one back
 *     through /internal/processing/progress as it genuinely completes. That is
 *     why the worker does not write PARSING..INDEXING itself: doing so around a
 *     single HTTP call would be inventing progress it cannot observe.
 *
 * A document only reaches COMPLETED after the AI service has really parsed,
 * embedded and indexed it. While the AI service is unconfigured the job fails
 * fast and honestly.
 */
@Processor(RESUME_PROCESSING_QUEUE, { concurrency: 2 })
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  constructor(
    private readonly processing: ProcessingService,
    private readonly ai: AiServiceClient,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessDocumentJobData>): Promise<void> {
    const { documentId, organizationId } = job.data;
    const attempts = job.attemptsMade + 1;

    try {
      if (!this.ai.enabled) {
        // Honest stop, not a fake success. Unrecoverable: retrying cannot
        // configure the service.
        throw new UnrecoverableError(
          'AI service is not configured (AI_SERVICE_URL is unset); document ' +
            'parsing cannot run yet',
        );
      }

      // Re-read from the database rather than trusting the job payload, and
      // scope by organization so a malformed job cannot cross tenants.
      const document = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
        select: {
          id: true,
          organizationId: true,
          candidateId: true,
          originalFileName: true,
          storageKey: true,
          mimeType: true,
          type: true,
        },
      });

      if (!document) {
        throw new UnrecoverableError(
          `Document ${documentId} no longer exists in organization ${organizationId}`,
        );
      }

      const content = await this.storage.getObject(document.storageKey);

      // Stages PARSING -> INDEXING are written by the AI service's progress
      // callbacks while this call is in flight.
      const result = await this.ai.processDocument({
        documentId: document.id,
        // The job payload's organizationId — the document was fetched under
        // it, so they are equal, and (unlike the nullable column) it is
        // guaranteed set: personal (org-less) documents are never enqueued.
        organizationId,
        candidateId: document.candidateId,
        fileName: document.originalFileName,
        documentType: document.type,
        content,
        mimeType: document.mimeType,
      });

      if (result.vectorsIndexed <= 0) {
        // Nothing was indexed, so the document is not searchable. Reporting
        // COMPLETED here would claim work that did not happen.
        throw new Error(
          `AI service indexed no vectors for document ${documentId}`,
        );
      }

      await this.processing.markCompleted(documentId, result.pageCount);
      await job.updateProgress(PROCESSING_PROGRESS.COMPLETED);

      this.logger.log(
        `Document ${documentId} processed: ${result.chunksCreated} chunk(s), ` +
          `${result.vectorsIndexed} vector(s), ${result.pageCount} page(s)`,
      );
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

/** Re-exported so tests can assert the stage set without importing Prisma. */
export const AI_REPORTED_STAGES = [
  DocumentStatus.PARSING,
  DocumentStatus.CHUNKING,
  DocumentStatus.EMBEDDING,
  DocumentStatus.INDEXING,
] as const;
