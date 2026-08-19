import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import {
  DocumentStatus,
  ProcessingJobStatus,
  ProcessingJobType,
} from '../generated/prisma/enums';
import { ProcessingGateway } from './processing.gateway';

/**
 * Owns the document/processing-job lifecycle.
 *
 * Document status advances only as real work completes:
 *   UPLOADED → QUEUED → PARSING → CHUNKING → EMBEDDING → INDEXING → COMPLETED
 * or → FAILED. Nothing here marks a document COMPLETED speculatively; that
 * transition is only reachable from the processor after the AI service has
 * actually returned.
 */
@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly gateway: ProcessingGateway,
  ) {}

  /** Creates the PENDING tracking row that accompanies a queued document. */
  createJob(organizationId: string, documentId: string) {
    return this.prisma.processingJob.create({
      data: {
        organizationId,
        documentId,
        type: ProcessingJobType.PROCESS_DOCUMENT,
        status: ProcessingJobStatus.PENDING,
        progress: 0,
      },
    });
  }

  async markQueued(jobId: string, bullmqJobId: string | null) {
    const job = await this.prisma.processingJob.update({
      where: { id: jobId },
      data: { bullmqJobId, status: ProcessingJobStatus.QUEUED, progress: 0 },
    });
    await this.prisma.document.update({
      where: { id: job.documentId },
      data: { status: DocumentStatus.QUEUED },
    });
    this.gateway.emitProgress(job.organizationId, {
      jobId: job.id,
      documentId: job.documentId,
      status: ProcessingJobStatus.QUEUED,
      documentStatus: DocumentStatus.QUEUED,
      progress: 0,
    });
    return job;
  }

  /**
   * Advances both the ProcessingJob and its Document to the next real stage
   * and pushes the change to any connected frontend.
   */
  async advance(
    documentId: string,
    documentStatus: DocumentStatus,
    progress: number,
    attempts?: number,
  ) {
    const job = await this.prisma.processingJob.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });

    const [document] = await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: documentId },
        data: { status: documentStatus },
      }),
      ...(job
        ? [
            this.prisma.processingJob.update({
              where: { id: job.id },
              data: {
                status: ProcessingJobStatus.RUNNING,
                progress,
                ...(attempts !== undefined ? { attempts } : {}),
              },
            }),
          ]
        : []),
    ]);

    if (document.organizationId) {
      this.gateway.emitProgress(document.organizationId, {
        jobId: job?.id ?? null,
        documentId,
        status: ProcessingJobStatus.RUNNING,
        documentStatus,
        progress,
      });
    }
    return document;
  }

  async markCompleted(documentId: string, pageCount?: number) {
    const job = await this.prisma.processingJob.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });

    const [document] = await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.COMPLETED,
          ...(pageCount !== undefined ? { pageCount } : {}),
        },
      }),
      ...(job
        ? [
            this.prisma.processingJob.update({
              where: { id: job.id },
              data: {
                status: ProcessingJobStatus.COMPLETED,
                progress: 100,
                errorMessage: null,
              },
            }),
          ]
        : []),
    ]);

    // Personal (org-less) documents are never processed, so this branch is
    // always taken in practice; the guard keeps the nullable column honest.
    if (document.organizationId) {
      this.gateway.emitCompleted(document.organizationId, {
        jobId: job?.id ?? null,
        documentId,
        status: ProcessingJobStatus.COMPLETED,
        documentStatus: DocumentStatus.COMPLETED,
        progress: 100,
      });
    }
    return document;
  }

  async markFailed(
    documentId: string,
    errorMessage: string,
    attempts?: number,
  ) {
    const job = await this.prisma.processingJob.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });

    const [document] = await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.FAILED },
      }),
      ...(job
        ? [
            this.prisma.processingJob.update({
              where: { id: job.id },
              data: {
                status: ProcessingJobStatus.FAILED,
                // Truncated so a verbose driver error cannot bloat the row.
                errorMessage: errorMessage.slice(0, 500),
                ...(attempts !== undefined ? { attempts } : {}),
              },
            }),
          ]
        : []),
    ]);

    this.logger.warn(`Processing failed for document ${documentId}`);
    if (document.organizationId) {
      this.gateway.emitFailed(document.organizationId, {
        jobId: job?.id ?? null,
        documentId,
        status: ProcessingJobStatus.FAILED,
        documentStatus: DocumentStatus.FAILED,
        progress: job?.progress ?? 0,
        errorMessage: errorMessage.slice(0, 500),
      });
    }
    return document;
  }

  /**
   * Records a stage reported by the AI service.
   *
   * The organizationId is verified against the document before anything is
   * written, so a compromised service credential still cannot move another
   * tenant's document.
   */
  async recordStage(
    organizationId: string,
    documentId: string,
    documentStatus: DocumentStatus,
    progress: number,
  ) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true },
    });
    if (!document) {
      this.logger.warn(
        `Ignoring progress for unknown document in this organization`,
      );
      return null;
    }
    return this.advance(documentId, documentStatus, progress);
  }

  // -- Read APIs for the frontend -----------------------------------------

  async findAll(
    organizationId: string,
    page: number,
    limit: number,
    status?: ProcessingJobStatus,
  ): Promise<PaginatedResult<unknown>> {
    const where = {
      ...this.tenant.scope(organizationId),
      ...(status ? { status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.processingJob.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          document: {
            select: {
              id: true,
              originalFileName: true,
              status: true,
              type: true,
            },
          },
        },
      }),
      this.prisma.processingJob.count({ where }),
    ]);

    return paginated(data, total, page, limit);
  }

  async findOne(organizationId: string, id: string) {
    const job = await this.prisma.processingJob.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      include: {
        document: {
          select: {
            id: true,
            originalFileName: true,
            status: true,
            type: true,
            pageCount: true,
          },
        },
      },
    });
    return this.tenant.assertFound(job, 'Processing job');
  }

  async findByDocument(organizationId: string, documentId: string) {
    return this.prisma.processingJob.findMany({
      where: { documentId, ...this.tenant.scope(organizationId) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
