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
import { CandidateLinksService } from '../candidate-links/candidate-links.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { hostnameOf } from '../web-ingestion/url-policy';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import {
  ApplicationSource,
  ApplicationStatus,
  DocumentStatus,
  DocumentType,
  VacancyStatus,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
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
    private readonly candidateLinks: CandidateLinksService,
    private readonly events: DomainEventsService,
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
   *   snapshot of EVERY submitted evidence source -> BullMQ -> AI processing.
   *
   * ## What is submitted
   *
   * All of the candidate's personal evidence: every personal file (≤ 3) and
   * every COMPLETED professional link (≤ 3). A recruiter analysing an
   * application sees the whole picture the candidate maintains, not just their
   * resume — a portfolio and a certificate are evidence too.
   *
   * Only COMPLETED links are submitted. A pending, in-flight or failed link
   * has no verified content, and freezing "whatever we have" into an
   * organization's evidence would submit something nobody can trust.
   *
   * A resume is still REQUIRED. Links supplement evidence; they do not replace
   * the document the product has always required to apply.
   *
   * ## Why snapshots
   *
   * Each source is COPIED, never referenced, and each copy is immutable:
   *  - history: the application keeps the bytes and the page content actually
   *    submitted, however often the profile is changed afterwards — a
   *    candidate refreshing their portfolio in November does not rewrite what
   *    they sent in August;
   *  - tenancy: only the copies (owned by the vacancy's organization) are ever
   *    indexed into the tenant collection, so organization B can never
   *    retrieve evidence from an application made to organization A, and no
   *    recruiter path reaches the candidate's live personal sources.
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
    // Every personal file is submitted, with the primary resume first so it
    // becomes the application's `submittedDocumentId`.
    const personalDocuments = await this.prisma.document.findMany({
      where: { candidateAccountId: account.id, organizationId: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        storageKey: true,
        originalFileName: true,
        mimeType: true,
        type: true,
      },
    });
    const primary = personalDocuments.find(
      (document) => document.id === account.resumeDocumentId,
    );
    if (!primary) {
      throw new UnprocessableEntityException(
        'Upload a resume to your candidate account before applying',
      );
    }
    const submitted = [
      primary,
      ...personalDocuments.filter((document) => document.id !== primary.id),
    ];
    const submittedLinks = await this.candidateLinks.listSubmittableLinks(
      account.id,
    );

    // Duplicate policy: one LIVE application per vacancy per candidate account.
    //
    // A rejection ends an attempt; it does not ban the person from the role,
    // so a previous REJECTED application no longer blocks a new one — the old
    // row is left exactly as it is and the new attempt becomes a separate
    // application with its own id, status and createdAt. Every other status,
    // WITHDRAWN included, still blocks: this is deliberately about rejection
    // only, and the recruiter can still move a withdrawn one back by hand.
    //
    // The database enforces the same rule under concurrency through a partial
    // unique index (status <> 'REJECTED'); this check exists to answer with a
    // clean 409 instead of a constraint error.
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
      const liveApplication = await this.prisma.application.findFirst({
        where: {
          vacancyId: vacancy.id,
          candidateId: existingCandidate.id,
          status: { not: ApplicationStatus.REJECTED },
        },
        select: { id: true },
      });
      if (liveApplication) {
        throw new ConflictException('You have already applied to this job');
      }
    }

    // Copy the bytes under the ORGANIZATION's namespace first; the objects are
    // orphaned (and cleaned up) if the transaction fails, which is harmless —
    // the reverse order could commit rows pointing at nothing.
    const copies: SubmittedFileCopy[] = [];
    try {
      for (const document of submitted) {
        const bytes = await this.storage.getObject(document.storageKey);
        const documentId = randomUUID();
        const storageKey = StorageService.buildKey(
          vacancy.organizationId,
          documentId,
          document.originalFileName,
        );
        await this.storage.upload({
          key: storageKey,
          body: bytes,
          contentType: document.mimeType,
          originalFileName: document.originalFileName,
        });
        copies.push({
          documentId,
          storageKey,
          originalFileName: document.originalFileName,
          mimeType: document.mimeType,
          type: document.type,
          fileSize: bytes.length,
          isPrimary: document.id === primary.id,
          // LINEAGE. Without it, a candidate deleting this file later leaves
          // no way to find the copies made from it, and the deletion would
          // have to be either a guess or a no-op. Recorded here, at the only
          // moment the relationship is known for certain.
          sourceCandidateDocumentId: document.id,
        });
      }
    } catch (error) {
      await this.discardCopies(copies);
      throw error;
    }
    const primaryCopy = copies.find((copy) => copy.isPrimary)!;

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

        for (const copy of copies) {
          await tx.document.create({
            data: {
              id: copy.documentId,
              organizationId: vacancy.organizationId,
              candidateId: candidate.id,
              type: copy.type,
              originalFileName: copy.originalFileName,
              storageKey: copy.storageKey,
              mimeType: copy.mimeType,
              fileSize: copy.fileSize,
              sourceCandidateDocumentId: copy.sourceCandidateDocumentId,
            },
          });
        }

        const created = await tx.application.create({
          data: {
            vacancyId: vacancy.id,
            candidateId: candidate.id,
            status: ApplicationStatus.NEW,
            source: ApplicationSource.DIRECT,
            submittedDocumentId: primaryCopy.documentId,
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

        // The application row has to exist before the copies can point at it;
        // this is what makes "these are the files sent to THIS vacancy"
        // auditable rather than inferred.
        await tx.document.updateMany({
          where: { id: { in: copies.map((copy) => copy.documentId) } },
          data: { applicationId: created.id },
        });

        const linkSourceIds: string[] = [];
        for (const link of submittedLinks) {
          const source = await tx.applicationLinkSource.create({
            data: {
              organizationId: vacancy.organizationId,
              candidateId: candidate.id,
              applicationId: created.id,
              // Plain column, no FK: the candidate may delete this link
              // tomorrow and nothing here may change or cascade.
              sourceLinkId: link.id,
              url: link.url,
              normalizedUrl: link.normalizedUrl,
              title: link.title ?? hostnameOf(link.url),
              detectedType: link.detectedType,
              // The exact content the AI saw, copied rather than referenced.
              sections: link.sections as Prisma.InputJsonValue,
              contentHash: link.contentHash,
              charCount: link.charCount ?? 0,
              pagesFetched: link.pagesFetched ?? 1,
              fetchMode: link.fetchMode ?? 'STATIC',
              fetchedAt: link.lastFetchedAt ?? new Date(),
            },
            select: { id: true },
          });
          linkSourceIds.push(source.id);
        }

        return {
          application: created,
          candidateId: candidate.id,
          linkSourceIds,
        };
      })
      .catch(async (error: unknown) => {
        await this.discardCopies(copies);
        if ((error as { code?: string })?.code === 'P2002') {
          // Concurrent double-submit lost the race on the partial unique index
          // over live attempts — the other request created the application.
          throw new ConflictException('You have already applied to this job');
        }
        throw error;
      });

    // Queue AI processing of every ORG-SCOPED copy. Redis being down must not
    // lose the application: rows and bytes are durable, the jobs are marked
    // FAILED and can be requeued.
    for (const copy of copies) {
      const processingJob = await this.processing.createJob(
        vacancy.organizationId,
        copy.documentId,
      );
      try {
        const bullmqJobId = await this.producer.enqueueDocument({
          documentId: copy.documentId,
          organizationId: vacancy.organizationId,
          candidateId: result.candidateId,
        });
        await this.processing.markQueued(processingJob.id, bullmqJobId);
      } catch (error) {
        await this.processing.markFailed(
          copy.documentId,
          `Failed to enqueue processing job: ${(error as Error).message}`,
        );
        this.logger.error(
          `Enqueue failed for direct-application document ${copy.documentId}: ${(error as Error).message}`,
        );
      }
    }

    // Link snapshots need no ProcessingJob row: there is no file, no upload
    // progress and no recruiter-facing pipeline UI for them — the source row's
    // own status is the whole lifecycle, exactly as for personal documents.
    for (const linkSourceId of result.linkSourceIds) {
      try {
        await this.producer.enqueueApplicationLink({
          linkSourceId,
          organizationId: vacancy.organizationId,
          candidateId: result.candidateId,
        });
      } catch (error) {
        await this.prisma.applicationLinkSource.updateMany({
          where: { id: linkSourceId },
          data: {
            status: DocumentStatus.FAILED,
            errorMessage: `Failed to enqueue indexing: ${(error as Error).message}`,
          },
        });
        this.logger.error(
          `Enqueue failed for application link source ${linkSourceId}: ${(error as Error).message}`,
        );
      }
    }

    // The application row is durably committed by now — tell the vacancy's
    // creator. (Never before: a rolled-back apply must produce no ghost
    // notification.)
    this.events.publish('application.created', {
      organizationId: vacancy.organizationId,
      vacancyId: vacancy.id,
      applicationId: (result.application as { id: string }).id,
      candidateId: result.candidateId,
    });

    return result.application;
  }

  /**
   * Removes org-side objects written for an application that did not commit.
   * Best effort: an orphaned object is a small storage leak, while throwing
   * here would replace the real error with a cleanup error.
   */
  private async discardCopies(copies: SubmittedFileCopy[]): Promise<void> {
    await Promise.all(
      copies.map((copy) =>
        this.storage.delete(copy.storageKey).catch(() => undefined),
      ),
    );
  }
}

/** One org-scoped file copy, uploaded but not yet committed to the database. */
interface SubmittedFileCopy {
  documentId: string;
  storageKey: string;
  originalFileName: string;
  mimeType: string;
  type: DocumentType;
  fileSize: number;
  /** The profile's primary resume — becomes Application.submittedDocumentId. */
  isPrimary: boolean;
  /** The personal document this copy was made from. See Document.sourceCandidateDocumentId. */
  sourceCandidateDocumentId: string;
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
