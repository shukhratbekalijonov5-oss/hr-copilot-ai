import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import {
  DELETE_PERSONAL_RESUME_INDEX_JOB,
  PROCESSING_PROGRESS,
  PROCESS_PERSONAL_RESUME_JOB,
  RESUME_PROCESSING_QUEUE,
  SYNC_VACANCY_INDEX_JOB,
  type PersonalResumeJobData,
  type ProcessDocumentJobData,
  type ResumeQueueJobData,
  type SyncVacancyIndexJobData,
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

  async process(job: Job<ResumeQueueJobData>): Promise<void> {
    switch (job.name) {
      case PROCESS_PERSONAL_RESUME_JOB:
        return this.processPersonalResume(job.data as PersonalResumeJobData);
      case DELETE_PERSONAL_RESUME_INDEX_JOB:
        return this.deletePersonalResumeIndex(
          job.data as PersonalResumeJobData,
        );
      case SYNC_VACANCY_INDEX_JOB:
        return this.syncVacancyIndex(job.data as SyncVacancyIndexJobData);
      default:
        return this.processOrgDocument(job as Job<ProcessDocumentJobData>);
    }
  }

  /**
   * PERSONAL resume → candidate-scoped index. Deliberately different from the
   * org path: no ProcessingJob row and no websocket progress (there is no
   * recruiter processing UI for personal documents) — the Document row's
   * status is the whole lifecycle. And no organization anywhere.
   */
  private async processPersonalResume(
    data: PersonalResumeJobData,
  ): Promise<void> {
    const { documentId, candidateAccountId } = data;
    try {
      if (!this.ai.enabled) {
        throw new UnrecoverableError(
          'AI service is not configured (AI_SERVICE_URL is unset)',
        );
      }
      // Re-read and verify OWNERSHIP: the document must be a personal one
      // belonging to exactly this candidate account.
      const document = await this.prisma.document.findFirst({
        where: { id: documentId, candidateAccountId, organizationId: null },
        select: {
          id: true,
          originalFileName: true,
          storageKey: true,
          mimeType: true,
        },
      });
      if (!document) {
        throw new UnrecoverableError(
          `Personal document ${documentId} no longer exists for this account`,
        );
      }

      const content = await this.storage.getObject(document.storageKey);
      const result = await this.ai.processPersonalResume({
        documentId: document.id,
        candidateAccountId,
        fileName: document.originalFileName,
        content,
        mimeType: document.mimeType,
      });
      if (result.vectorsIndexed <= 0) {
        throw new Error(
          `AI service indexed no vectors for personal document ${documentId}`,
        );
      }

      await this.prisma.document.updateMany({
        where: { id: documentId, candidateAccountId },
        data: { status: DocumentStatus.COMPLETED, pageCount: result.pageCount },
      });
      this.logger.log(
        `Personal resume ${documentId} indexed: ${result.vectorsIndexed} vector(s)`,
      );
    } catch (error) {
      await this.prisma.document.updateMany({
        where: { id: documentId, candidateAccountId },
        data: { status: DocumentStatus.FAILED },
      });
      throw error;
    }
  }

  private async deletePersonalResumeIndex(
    data: PersonalResumeJobData,
  ): Promise<void> {
    if (!this.ai.enabled) return;
    await this.ai.deletePersonalResume(
      data.candidateAccountId,
      data.documentId,
    );
    this.logger.log(
      `Personal resume ${data.documentId} removed from the candidate index`,
    );
  }

  /**
   * Reconciles one vacancy with the candidate-discoverable index from the
   * CURRENT database state: OPEN → (re)index its candidate-visible fields;
   * anything else (draft, closed, archived, deleted) → remove it. Firing this
   * repeatedly, out of order, or after deletion always converges.
   */
  private async syncVacancyIndex(data: SyncVacancyIndexJobData): Promise<void> {
    if (!this.ai.enabled) {
      throw new UnrecoverableError(
        'AI service is not configured (AI_SERVICE_URL is unset)',
      );
    }
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id: data.vacancyId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        title: true,
        description: true,
        location: true,
        employmentType: true,
        requirements: { select: { text: true, required: true } },
      },
    });

    if (!vacancy || vacancy.status !== 'OPEN') {
      await this.ai.deleteVacancyIndex(data.vacancyId);
      this.logger.log(`Vacancy ${data.vacancyId} removed from the job index`);
      return;
    }

    // Candidate-visible fields ONLY — the select above is the allow-list; no
    // recruiter-side counts, notes or creator data are ever sent.
    await this.ai.indexVacancy({
      vacancyId: vacancy.id,
      organizationId: vacancy.organizationId,
      status: vacancy.status,
      title: vacancy.title,
      description: vacancy.description,
      location: vacancy.location,
      employmentType: vacancy.employmentType,
      requirements: vacancy.requirements,
    });
    this.logger.log(`Vacancy ${data.vacancyId} indexed for job matching`);
  }

  private async processOrgDocument(
    job: Job<ProcessDocumentJobData>,
  ): Promise<void> {
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
