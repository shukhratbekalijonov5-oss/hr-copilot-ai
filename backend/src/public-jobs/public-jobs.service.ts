import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ProcessingService } from '../processing/processing.service';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';
import { CandidateAccountService } from '../candidate-account/candidate-account.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import {
  ApplicationSource,
  ApplicationStatus,
  DocumentType,
  VacancyStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { QueryPublicJobsDto } from './dto/query-public-jobs.dto';

/**
 * Public job discovery and authenticated direct application.
 *
 * Discovery exposes ONLY OPEN vacancies and only advertisement-safe fields:
 * no applicant counts, no creator, no internal ids beyond the public slug, no
 * processing or evidence data. DRAFT/CLOSED/ARCHIVED vacancies do not exist as
 * far as these endpoints are concerned — an unknown or non-OPEN slug is a 404.
 */
@Injectable()
export class PublicJobsService {
  private readonly logger = new Logger(PublicJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly processing: ProcessingService,
    private readonly producer: DocumentProcessingProducer,
    private readonly candidateAccounts: CandidateAccountService,
  ) {}

  async list(query: QueryPublicJobsDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.VacancyWhereInput = {
      status: VacancyStatus.OPEN,
      ...(query.location ? { location: query.location } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vacancy.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: PUBLIC_LIST_SELECT,
      }),
      this.prisma.vacancy.count({ where }),
    ]);
    return paginated(data, total, query.page, query.limit);
  }

  async detail(publicSlug: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      // Status is part of the lookup: a CLOSED job's slug 404s exactly like a
      // slug that never existed.
      where: { publicSlug, status: VacancyStatus.OPEN },
      select: {
        ...PUBLIC_LIST_SELECT,
        description: true,
        requirements: {
          select: { text: true, type: true, required: true },
          orderBy: { type: 'asc' },
        },
      },
    });
    if (!vacancy) throw new NotFoundException('Job not found');
    return vacancy;
  }

  /**
   * Authenticated direct application:
   *
   *   CandidateAccount -> OPEN vacancy -> org-side Candidate (one per account
   *   per organization, reused) -> Application(source=DIRECT) -> org-scoped
   *   snapshot copy of the profile resume -> BullMQ -> AI processing.
   *
   * The snapshot copy is what makes both invariants hold:
   *  - history: the application keeps the bytes actually submitted, however
   *    often the profile resume is replaced afterwards;
   *  - tenancy: only the copy (owned by the vacancy's organization) is ever
   *    indexed, so organization B can never retrieve evidence from an
   *    application made to organization A.
   */
  async apply(userId: string, publicSlug: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { publicSlug, status: VacancyStatus.OPEN },
      select: { id: true, organizationId: true },
    });
    if (!vacancy) throw new NotFoundException('Job not found');

    const account = await this.candidateAccounts.requireAccount(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true, email: true },
    });

    if (!account.resumeDocumentId) {
      throw new UnprocessableEntityException(
        'Upload a resume to your candidate account before applying',
      );
    }
    const personalResume = await this.prisma.document.findUnique({
      where: { id: account.resumeDocumentId },
      select: { storageKey: true, originalFileName: true, mimeType: true },
    });
    if (!personalResume) {
      throw new UnprocessableEntityException(
        'Upload a resume to your candidate account before applying',
      );
    }

    // Duplicate policy: one application per vacancy per candidate account —
    // ever. A withdrawn application also blocks re-applying in this MVP; the
    // recruiter can still move it back to an active stage by hand.
    const existingCandidate = await this.prisma.candidate.findUnique({
      where: {
        organizationId_candidateAccountId: {
          organizationId: vacancy.organizationId,
          candidateAccountId: account.id,
        },
      },
      select: { id: true },
    });
    if (existingCandidate) {
      const existingApplication = await this.prisma.application.findUnique({
        where: {
          vacancyId_candidateId: {
            vacancyId: vacancy.id,
            candidateId: existingCandidate.id,
          },
        },
        select: { id: true },
      });
      if (existingApplication) {
        throw new ConflictException('You have already applied to this job');
      }
    }

    // Snapshot the resume bytes under the ORGANIZATION's namespace first; the
    // object is orphaned (and cleaned up) if the transaction fails, which is
    // harmless — the reverse order could commit rows pointing at nothing.
    const bytes = await this.storage.getObject(personalResume.storageKey);
    const documentId = randomUUID();
    const storageKey = StorageService.buildKey(
      vacancy.organizationId,
      documentId,
      personalResume.originalFileName,
    );
    await this.storage.upload({
      key: storageKey,
      body: bytes,
      contentType: personalResume.mimeType,
      originalFileName: personalResume.originalFileName,
    });

    const result = await this.prisma
      .$transaction(async (tx) => {
        const candidate = await tx.candidate.upsert({
          where: {
            organizationId_candidateAccountId: {
              organizationId: vacancy.organizationId,
              candidateAccountId: account.id,
            },
          },
          // An existing org-side record is reused as-is: recruiters may have
          // enriched it, and an application must not overwrite their data.
          update: {},
          create: {
            organizationId: vacancy.organizationId,
            candidateAccountId: account.id,
            fullName: user.fullName,
            email: user.email,
            phone: account.phone,
            location: account.location,
            currentTitle: account.headline,
          },
          select: { id: true },
        });

        await tx.document.create({
          data: {
            id: documentId,
            organizationId: vacancy.organizationId,
            candidateId: candidate.id,
            type: DocumentType.RESUME,
            originalFileName: personalResume.originalFileName,
            storageKey,
            mimeType: personalResume.mimeType,
            fileSize: bytes.length,
          },
        });

        const created = await tx.application.create({
          data: {
            vacancyId: vacancy.id,
            candidateId: candidate.id,
            status: ApplicationStatus.NEW,
            source: ApplicationSource.DIRECT,
            submittedDocumentId: documentId,
          },
          select: {
            id: true,
            status: true,
            source: true,
            createdAt: true,
            vacancy: {
              select: {
                publicSlug: true,
                title: true,
                organization: { select: { name: true } },
              },
            },
          },
        });
        return { application: created, candidateId: candidate.id };
      })
      .catch(async (error: unknown) => {
        await this.storage.delete(storageKey).catch(() => undefined);
        if ((error as { code?: string })?.code === 'P2002') {
          // Concurrent double-submit lost the race on (vacancyId, candidateId).
          throw new ConflictException('You have already applied to this job');
        }
        throw error;
      });

    // Queue AI processing of the ORG-SCOPED copy, exactly like a recruiter
    // upload. Redis being down must not lose the application: rows and bytes
    // are durable, the job is marked FAILED and can be requeued.
    const processingJob = await this.processing.createJob(
      vacancy.organizationId,
      documentId,
    );
    try {
      const bullmqJobId = await this.producer.enqueueDocument({
        documentId,
        organizationId: vacancy.organizationId,
        candidateId: result.candidateId,
      });
      await this.processing.markQueued(processingJob.id, bullmqJobId);
    } catch (error) {
      await this.processing.markFailed(
        documentId,
        `Failed to enqueue processing job: ${(error as Error).message}`,
      );
      this.logger.error(
        `Enqueue failed for direct-application document ${documentId}: ${(error as Error).message}`,
      );
    }

    return result.application;
  }
}

/** Advertisement-safe fields only. */
const PUBLIC_LIST_SELECT = {
  publicSlug: true,
  title: true,
  department: true,
  location: true,
  employmentType: true,
  experienceLevel: true,
  createdAt: true,
  organization: { select: { name: true } },
} as const;
