import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { StorageService } from '../storage/storage.service';
import { ProcessingService } from '../processing/processing.service';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';
import { AiServiceClient } from '../ai/ai-service.client';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { DocumentStatus, DocumentType } from '../generated/prisma/enums';
import { validateUploadedFile, type ValidatableFile } from './file-validation';
import type { UploadDocumentDto } from './dto/upload-document.dto';
import type { QueryDocumentsDto } from './dto/query-documents.dto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly maxFileSizeBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly storage: StorageService,
    private readonly processing: ProcessingService,
    private readonly producer: DocumentProcessingProducer,
    private readonly ai: AiServiceClient,
    configService: ConfigService,
  ) {
    this.maxFileSizeBytes = configService.get<number>(
      'storage.maxFileSizeBytes',
      10 * 1024 * 1024,
    );
  }

  /**
   * Upload flow, in order:
   *   1. validate MIME/extension/magic number
   *   2. validate size
   *   3. create the Document row
   *   4. upload the bytes to storage
   *   5. enqueue the BullMQ job
   *   6. return immediately
   *
   * No parsing or embedding happens on this request thread.
   */
  async upload(
    organizationId: string,
    file: ValidatableFile | undefined,
    dto: UploadDocumentDto,
  ) {
    // 1 + 2
    const validated = validateUploadedFile(file, this.maxFileSizeBytes);

    // The candidate must belong to the caller's organization.
    if (dto.candidateId) {
      const candidate = await this.prisma.candidate.findFirst({
        where: { id: dto.candidateId, ...this.tenant.scope(organizationId) },
        select: { id: true },
      });
      this.tenant.assertFound(candidate, 'Candidate');
    }

    const documentId = randomUUID();
    const storageKey = StorageService.buildKey(
      organizationId,
      documentId,
      validated.originalname,
    );

    // 3
    const document = await this.prisma.document.create({
      data: {
        id: documentId,
        organizationId,
        candidateId: dto.candidateId ?? null,
        type: dto.type ?? DocumentType.RESUME,
        originalFileName: validated.originalname.slice(0, 255),
        storageKey,
        mimeType: validated.mimetype,
        fileSize: validated.size,
      },
    });

    // 4 — if this fails, drop the row so no Document points at missing bytes.
    try {
      await this.storage.upload({
        key: storageKey,
        body: validated.buffer,
        contentType: validated.mimetype,
        originalFileName: validated.originalname,
      });
    } catch (error) {
      await this.prisma.document.delete({ where: { id: document.id } });
      this.logger.error(
        `Storage upload failed for document ${document.id}: ${(error as Error).message}`,
      );
      throw error;
    }

    // 5 — the processing job row is the durable record; the BullMQ id is
    // attached once the queue accepts it.
    const processingJob = await this.processing.createJob(
      organizationId,
      document.id,
    );

    let bullmqJobId: string | null = null;
    try {
      bullmqJobId = await this.producer.enqueueDocument({
        documentId: document.id,
        organizationId,
        candidateId: document.candidateId,
      });
      await this.processing.markQueued(processingJob.id, bullmqJobId);
    } catch (error) {
      // Redis being unavailable must not lose the upload — the file and rows
      // are already durable and the job can be retried.
      await this.processing.markFailed(
        document.id,
        `Failed to enqueue processing job: ${(error as Error).message}`,
      );
      this.logger.error(
        `Enqueue failed for document ${document.id}: ${(error as Error).message}`,
      );
    }

    // 6
    return {
      id: document.id,
      type: document.type,
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      status: document.status,
      candidateId: document.candidateId,
      processingJobId: processingJob.id,
      createdAt: document.createdAt,
    };
  }

  async findAll(
    organizationId: string,
    query: QueryDocumentsDto,
  ): Promise<PaginatedResult<unknown>> {
    const where = {
      ...this.tenant.scope(organizationId),
      ...(query.candidateId ? { candidateId: query.candidateId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        // storageKey is deliberately excluded from list responses.
        select: {
          id: true,
          type: true,
          originalFileName: true,
          mimeType: true,
          fileSize: true,
          status: true,
          pageCount: true,
          candidateId: true,
          createdAt: true,
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(organizationId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      select: {
        id: true,
        type: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        status: true,
        pageCount: true,
        candidateId: true,
        createdAt: true,
        updatedAt: true,
        processingJobs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            progress: true,
            attempts: true,
            errorMessage: true,
            createdAt: true,
          },
        },
      },
    });
    return this.tenant.assertFound(document, 'Document');
  }

  /** Short-lived signed URL. Storage credentials never reach the client. */
  async getDownloadUrl(organizationId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      select: { id: true, storageKey: true, originalFileName: true },
    });
    this.tenant.assertFound(document, 'Document');

    return {
      url: await this.storage.getSignedUrl(document!.storageKey),
      originalFileName: document!.originalFileName,
    };
  }

  /**
   * Requeues one document for processing.
   *
   * Deliberately explicit and per-document: the safe cases are documents that
   * failed for an environmental reason (the AI service was unavailable), not
   * ones that failed because the file itself is unusable. Blanket-retrying
   * every historical failure would repeatedly re-run documents that can never
   * succeed, so the caller decides which to retry and a corrupt file is
   * rejected up front.
   *
   * Re-indexing is safe: the AI service replaces a document's vectors rather
   * than appending, so this cannot duplicate them.
   *
   * An in-flight status alone does not block a retry — the queue is asked
   * whether a job really exists, so a document stranded in QUEUED by a dead
   * worker can still be recovered.
   */
  async reprocess(organizationId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      select: {
        id: true,
        organizationId: true,
        candidateId: true,
        storageKey: true,
        status: true,
      },
    });
    this.tenant.assertFound(document, 'Document');

    if (document!.status === DocumentStatus.COMPLETED) {
      throw new ConflictException(
        'Document is already processed; delete and re-upload to replace it',
      );
    }
    if (
      IN_FLIGHT_STATUSES.includes(document!.status) &&
      (await this.producer.hasLiveJob(id))
    ) {
      throw new ConflictException('Document is already being processed');
    }

    // The original file must still be in storage, otherwise the job would be
    // queued only to fail again on a missing object.
    if (!(await this.storage.exists(document!.storageKey))) {
      throw new UnprocessableEntityException(
        'The stored file for this document is missing; it must be re-uploaded',
      );
    }

    const processingJob = await this.processing.createJob(organizationId, id);
    const bullmqJobId = await this.producer.enqueueDocument(
      {
        documentId: id,
        organizationId,
        candidateId: document!.candidateId,
      },
      // The previous (failed) job still holds this document's job id.
      { replaceExisting: true },
    );
    await this.processing.markQueued(processingJob.id, bullmqJobId);

    this.logger.log(`Document ${id} requeued for processing`);
    return {
      id,
      status: DocumentStatus.QUEUED,
      processingJobId: processingJob.id,
    };
  }

  async remove(organizationId: string, id: string) {
    const document = await this.prisma.document.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      select: { id: true, storageKey: true },
    });
    this.tenant.assertFound(document, 'Document');

    await this.prisma.document.delete({ where: { id } });
    await this.storage.delete(document!.storageKey);

    // Drop the vectors too, so a deleted resume stops being searchable.
    // Best-effort: the document row and file are already gone, and a failure
    // here must not turn a successful delete into an error.
    if (this.ai.enabled) {
      try {
        await this.ai.deleteDocument(organizationId, id);
      } catch (error) {
        this.logger.warn(
          `Document ${id} deleted, but its vectors could not be removed: ${(error as Error).message}`,
        );
      }
    }

    return { id, deleted: true };
  }
}

/** Statuses meaning "a worker already has this document". */
const IN_FLIGHT_STATUSES: DocumentStatus[] = [
  DocumentStatus.QUEUED,
  DocumentStatus.PARSING,
  DocumentStatus.CHUNKING,
  DocumentStatus.EMBEDDING,
  DocumentStatus.INDEXING,
];
