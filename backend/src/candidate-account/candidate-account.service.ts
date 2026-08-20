import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AccountTypeService } from '../common/identity/account-type.service';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';
import {
  AiServiceClient,
  type AiCandidateProfile,
} from '../ai/ai-service.client';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import {
  ApplicationSource,
  ApplicationStatus,
  DocumentType,
} from '../generated/prisma/enums';
import {
  validateUploadedFile,
  type ValidatableFile,
} from '../documents/file-validation';
import {
  DEFAULT_MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_PERSONAL_DOCUMENTS,
  personalDocumentLimitReached,
} from '../documents/document-policy';
import type { CandidateAccount, Prisma } from '../generated/prisma/client';
import type { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { UpsertCandidateAccountDto } from './dto/upsert-candidate-account.dto';
import type { JobMatchesDto } from './dto/job-matches.dto';

/**
 * The caller's own job-seeker identity — and only ever their own.
 *
 * Every method takes the authenticated userId and resolves the account through
 * it; no method accepts a foreign account or user id, so there is no route
 * through which one candidate can address another's profile, resume or
 * applications. Cross-candidate probes therefore end at 404 by construction.
 *
 * The personal resume is a PERSONAL document: `organizationId = null`,
 * `candidateAccountId` set, stored under the `candidate/` key namespace, and
 * indexed ONLY into the candidate-scoped AI collection (a physically separate
 * Qdrant collection from all tenant data — see the AI service). Organizations
 * only ever receive org-scoped COPIES made at apply time (see
 * PublicJobsService.apply).
 */
@Injectable()
export class CandidateAccountService {
  private readonly logger = new Logger(CandidateAccountService.name);
  private readonly maxFileSizeBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly producer: DocumentProcessingProducer,
    private readonly ai: AiServiceClient,
    private readonly accountTypes: AccountTypeService,
    configService: ConfigService,
  ) {
    this.maxFileSizeBytes = configService.get<number>(
      'storage.maxFileSizeBytes',
      DEFAULT_MAX_DOCUMENT_UPLOAD_BYTES,
    );
  }

  async create(userId: string, dto: UpsertCandidateAccountDto) {
    // Central identity invariant, enforced here as well as at the guard so
    // no future caller (seed, script, other service) can hand an
    // ORGANIZATION user a candidate identity.
    await this.accountTypes.assertCanOwnCandidateAccount(userId);
    const existing = await this.prisma.candidateAccount.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('You already have a candidate account');
    }
    return this.prisma.candidateAccount.create({
      data: { userId, ...toAccountData(dto) },
      select: ACCOUNT_SELECT,
    });
  }

  async getMine(userId: string) {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { userId },
      select: ACCOUNT_SELECT,
    });
    if (!account) throw new NotFoundException('Candidate account not found');
    return account;
  }

  async updateMine(userId: string, dto: UpsertCandidateAccountDto) {
    await this.requireAccount(userId);
    return this.prisma.candidateAccount.update({
      where: { userId },
      data: toAccountData(dto),
      select: ACCOUNT_SELECT,
    });
  }

  /**
   * Legacy profile-resume endpoint: REPLACES the current primary resume (the
   * previous primary's bytes, row and vectors are removed), so it never grows
   * the personal collection past the limit on its own. Old applications are
   * unaffected — each snapshots its own org-scoped copy at apply time.
   */
  async uploadResume(userId: string, file: ValidatableFile | undefined) {
    const account = await this.requireAccount(userId);
    const validated = validateUploadedFile(file, this.maxFileSizeBytes);
    return this.storePersonalDocument(account, validated, {
      replaceCurrentResume: true,
    });
  }

  /**
   * Adds one personal document (up to MAX_PERSONAL_DOCUMENTS). The newest
   * upload becomes the primary resume — the one snapshotted at apply time.
   */
  async uploadPersonalDocument(
    userId: string,
    file: ValidatableFile | undefined,
  ) {
    const account = await this.requireAccount(userId);
    const validated = validateUploadedFile(file, this.maxFileSizeBytes);
    return this.storePersonalDocument(account, validated, {
      replaceCurrentResume: false,
    });
  }

  /**
   * Shared write path for both upload flavours.
   *
   * The 3-file invariant is enforced INSIDE a transaction that first takes a
   * row lock on the candidate account (`SELECT … FOR UPDATE`), which
   * serializes concurrent uploads for the same account — two racing requests
   * cannot both pass the count check, so the account can never end up with
   * more than MAX_PERSONAL_DOCUMENTS files. Every existing personal document
   * counts toward the limit, whatever its processing status; deleting one
   * (including a FAILED one) frees the slot.
   *
   * Bytes are uploaded before the rows so a failed transaction can only leave
   * an unreferenced object (which is deleted on the failure path), never a
   * row pointing at nothing.
   */
  private async storePersonalDocument(
    account: CandidateAccount,
    validated: ValidatableFile,
    { replaceCurrentResume }: { replaceCurrentResume: boolean },
  ) {
    const previous =
      replaceCurrentResume && account.resumeDocumentId
        ? await this.prisma.document.findUnique({
            where: { id: account.resumeDocumentId },
            select: { id: true, storageKey: true },
          })
        : null;

    const documentId = randomUUID();
    const storageKey = StorageService.buildPersonalKey(
      account.id,
      documentId,
      validated.originalname,
    );
    await this.storage.upload({
      key: storageKey,
      body: validated.buffer,
      contentType: validated.mimetype,
      originalFileName: validated.originalname,
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        // Concurrency guard: serialize per-account uploads on the row lock.
        await tx.$queryRaw`SELECT id FROM candidate_accounts WHERE id = ${account.id} FOR UPDATE`;
        const active = await tx.document.count({
          where: {
            candidateAccountId: account.id,
            // A replaced primary is deleted in this same transaction, so it
            // does not occupy a slot the new file is about to take over.
            ...(previous ? { id: { not: previous.id } } : {}),
          },
        });
        if (active >= MAX_PERSONAL_DOCUMENTS) {
          throw personalDocumentLimitReached();
        }
        await tx.document.create({
          data: {
            id: documentId,
            organizationId: null,
            candidateAccountId: account.id,
            type: DocumentType.RESUME,
            originalFileName: validated.originalname.slice(0, 255),
            storageKey,
            mimeType: validated.mimetype,
            fileSize: validated.size,
          },
        });
        await tx.candidateAccount.update({
          where: { id: account.id },
          data: { resumeDocumentId: documentId },
        });
        if (previous) {
          await tx.document.delete({ where: { id: previous.id } });
        }
      });
    } catch (error) {
      // Do not leave an unreferenced object behind if the rows failed.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }

    if (previous) {
      // Rows are already consistent; a failed object delete only leaks bytes.
      await this.storage.delete(previous.storageKey).catch(() => {
        this.logger.warn(
          `Replaced resume ${previous.id} but its stored object could not be removed`,
        );
      });
    }

    // Queue candidate-scoped AI indexing (and eviction of the replaced
    // resume's vectors). Redis being down must not lose the upload — the file
    // and rows are durable; the document simply stays UPLOADED.
    try {
      await this.producer.enqueuePersonalResume({
        documentId,
        candidateAccountId: account.id,
      });
      if (previous) {
        await this.producer.enqueuePersonalResumeIndexDeletion({
          documentId: previous.id,
          candidateAccountId: account.id,
        });
      }
    } catch (error) {
      this.logger.error(
        `Enqueue failed for personal resume ${documentId}: ${(error as Error).message}`,
      );
    }

    return {
      id: documentId,
      originalFileName: validated.originalname.slice(0, 255),
      mimeType: validated.mimetype,
      fileSize: validated.size,
    };
  }

  /** The caller's own personal documents, newest first. */
  async listPersonalDocuments(userId: string) {
    const account = await this.requireAccount(userId);
    const documents = await this.prisma.document.findMany({
      where: { candidateAccountId: account.id },
      orderBy: { createdAt: 'desc' },
      // storageKey deliberately excluded — internal keys never reach clients.
      select: {
        id: true,
        originalFileName: true,
        mimeType: true,
        fileSize: true,
        status: true,
        createdAt: true,
      },
    });
    return {
      data: documents,
      limit: MAX_PERSONAL_DOCUMENTS,
      remaining: Math.max(0, MAX_PERSONAL_DOCUMENTS - documents.length),
      primaryDocumentId: account.resumeDocumentId,
    };
  }

  /** Short-lived signed URL for ONE of the caller's own documents. */
  async getPersonalDocumentDownload(userId: string, documentId: string) {
    const account = await this.requireAccount(userId);
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        candidateAccountId: account.id,
        organizationId: null,
      },
      select: { storageKey: true, originalFileName: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    return {
      url: await this.storage.getSignedUrl(document.storageKey),
      originalFileName: document.originalFileName,
    };
  }

  /**
   * Permanently deletes ONE of the caller's own personal documents: the
   * stored bytes, the Document row and its candidate-collection vectors.
   *
   * Guarantees, in order:
   *  1. Bytes first. If the storage delete fails nothing else has changed and
   *     the whole call errors — success is never reported while the private
   *     file bytes provably remain. The delete is idempotent, so retrying is
   *     always safe.
   *  2. Rows next, atomically. If the deleted file was the primary resume the
   *     pointer moves to the newest remaining personal document (apply keeps
   *     working from the survivors).
   *  3. Vectors last, via the queue job that owns candidate-index eviction
   *     (BullMQ retries with backoff). If enqueueing fails the eviction runs
   *     inline as a fallback so Job Match cannot keep retrieving a deleted
   *     file. The processor additionally re-checks existence after indexing,
   *     so a worker finishing AFTER this delete cannot resurrect vectors.
   *
   * Scope: only this document. The account, profile, applications, saved
   * jobs, other personal documents and every org-side snapshot copy are
   * untouched — an organization's copy of an application resume is that
   * organization's record, not the candidate's to delete.
   */
  async deletePersonalDocument(userId: string, documentId: string) {
    const account = await this.requireAccount(userId);
    // Own personal documents only: a foreign id, an org-side copy or a
    // guessed uuid are indistinguishable 404s by construction.
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        candidateAccountId: account.id,
        organizationId: null,
      },
      select: { id: true, storageKey: true },
    });
    if (!document) throw new NotFoundException('Document not found');

    // 1 — bytes. A failure here aborts the delete with nothing changed.
    await this.storage.delete(document.storageKey);

    // 2 — rows. The FK from CandidateAccount.resumeDocumentId is SetNull, so
    // the pointer never dangles even before the explicit repoint below.
    await this.prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id: document.id } });
      if (account.resumeDocumentId === document.id) {
        const newest = await tx.document.findFirst({
          where: { candidateAccountId: account.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        await tx.candidateAccount.update({
          where: { id: account.id },
          data: { resumeDocumentId: newest?.id ?? null },
        });
      }
    });

    // 3 — vectors. The queue job is the established owner of candidate-index
    // eviction; the inline call is only the fallback when Redis is down.
    try {
      await this.producer.enqueuePersonalResumeIndexDeletion({
        documentId: document.id,
        candidateAccountId: account.id,
      });
    } catch (queueError) {
      this.logger.warn(
        `Eviction enqueue failed for personal document ${document.id}; evicting inline: ${(queueError as Error).message}`,
      );
      try {
        await this.ai.deletePersonalResume(account.id, document.id);
      } catch (aiError) {
        // Bytes and rows are gone; only stale vectors may remain. Surfaced
        // loudly — Job Match verification would also catch this.
        this.logger.error(
          `Personal document ${document.id} deleted but its vectors could not be evicted: ${(aiError as Error).message}`,
        );
      }
    }

    return { id: document.id, deleted: true };
  }

  /** Short-lived signed URL for the caller's own resume. */
  async getResumeDownload(userId: string) {
    const account = await this.requireAccount(userId);
    if (!account.resumeDocumentId) {
      throw new NotFoundException('No resume uploaded');
    }
    const document = await this.prisma.document.findUnique({
      where: { id: account.resumeDocumentId },
      select: { storageKey: true, originalFileName: true },
    });
    if (!document) throw new NotFoundException('No resume uploaded');
    return {
      url: await this.storage.getSignedUrl(document.storageKey),
      originalFileName: document.originalFileName,
    };
  }

  /**
   * The caller's own DIRECT applications. Only fields a candidate may see:
   * never recruiter notes, evidence maps, other applicants or ranking data.
   */
  async listMyApplications(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const account = await this.requireAccount(userId);
    const where = this.myApplicationsWhere(account.id);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: CANDIDATE_APPLICATION_SELECT,
      }),
      this.prisma.application.count({ where }),
    ]);
    return paginated(data, total, query.page, query.limit);
  }

  async getMyApplication(userId: string, applicationId: string) {
    const account = await this.requireAccount(userId);
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, ...this.myApplicationsWhere(account.id) },
      select: CANDIDATE_APPLICATION_SELECT,
    });
    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  /**
   * The ONLY status a candidate may set, and only on their own application:
   * WITHDRAWN, from a still-active stage. Terminal stages stay terminal, and
   * everything else remains a human recruiter decision.
   */
  async withdraw(userId: string, applicationId: string) {
    const account = await this.requireAccount(userId);
    const application = await this.prisma.application.findFirst({
      where: { id: applicationId, ...this.myApplicationsWhere(account.id) },
      select: { id: true, status: true },
    });
    if (!application) throw new NotFoundException('Application not found');

    if (!WITHDRAWABLE_STATUSES.includes(application.status)) {
      throw new ConflictException(
        `An application in status ${application.status} cannot be withdrawn`,
      );
    }

    return this.prisma.application.update({
      where: { id: application.id },
      data: { status: ApplicationStatus.WITHDRAWN },
      select: CANDIDATE_APPLICATION_SELECT,
    });
  }

  // -- Saved jobs -----------------------------------------------------------

  /** Idempotent save; only OPEN vacancies can be bookmarked. */
  async saveJob(userId: string, publicSlug: string) {
    const account = await this.requireAccount(userId);
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { publicSlug, status: 'OPEN' },
      select: { id: true },
    });
    if (!vacancy) throw new NotFoundException('Job not found');

    const existing = await this.prisma.savedJob.findUnique({
      where: {
        candidateAccountId_vacancyId: {
          candidateAccountId: account.id,
          vacancyId: vacancy.id,
        },
      },
    });
    if (existing) return { saved: true, savedAt: existing.createdAt };

    const created = await this.prisma.savedJob.create({
      data: { candidateAccountId: account.id, vacancyId: vacancy.id },
    });
    return { saved: true, savedAt: created.createdAt };
  }

  async unsaveJob(userId: string, publicSlug: string) {
    const account = await this.requireAccount(userId);
    await this.prisma.savedJob.deleteMany({
      where: { candidateAccountId: account.id, vacancy: { publicSlug } },
    });
    return { saved: false };
  }

  async listSavedJobs(userId: string, query: PaginationQueryDto) {
    const account = await this.requireAccount(userId);
    const where = { candidateAccountId: account.id };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.savedJob.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          vacancy: {
            select: {
              publicSlug: true,
              title: true,
              location: true,
              employmentType: true,
              // Status shown so the UI can mark a bookmark whose job closed.
              status: true,
              organization: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.savedJob.count({ where }),
    ]);

    return paginated(
      data.map((s) => ({ savedAt: s.createdAt, job: s.vacancy })),
      total,
      query.page,
      query.limit,
    );
  }

  // -- AI job matching ------------------------------------------------------

  /**
   * Candidate → vacancy AI matching over the caller's OWN identity only.
   *
   * Uses the personal CandidateAccount profile plus the candidate-scoped
   * resume index — never organization memberships, org-side candidate copies
   * or recruiter evidence, so switching organizations cannot change the data
   * source. Read-only: no application, candidate record or resume copy is
   * ever created by matching. Every vacancy the AI proposes is re-verified
   * against the database (must still be OPEN) before it is returned, and is
   * addressed by its public slug.
   */
  async jobMatches(userId: string, dto: JobMatchesDto) {
    const account = await this.requireAccount(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { preferredLocale: true },
    });
    const locale = dto.locale ?? user.preferredLocale;

    const profile = buildAiProfile(account);
    const hasProfileSignal =
      profile.skills.length > 0 ||
      profile.experience.length > 0 ||
      Boolean(profile.headline) ||
      Boolean(profile.summary);
    // ANY personal document counts as signal, not just the primary pointer —
    // the candidate index covers all of the account's (up to 3) files.
    const personalDocuments = await this.prisma.document.count({
      where: { candidateAccountId: account.id },
    });
    if (personalDocuments === 0 && !hasProfileSignal) {
      throw new UnprocessableEntityException(
        'Add profile details or upload a resume before matching jobs',
      );
    }

    const result = await this.ai.candidateJobMatches({
      candidateAccountId: account.id,
      profile,
      locale,
      limit: dto.limit,
    });

    // The index is a retrieval accelerator, never the authority: only
    // vacancies that are STILL open in the database are returned, and only
    // through their public identifiers.
    const vacancyIds = result.matches.map((m) => m.vacancyId);
    const [vacancies, savedJobs, applications] = await Promise.all([
      this.prisma.vacancy.findMany({
        where: { id: { in: vacancyIds }, status: 'OPEN' },
        select: {
          id: true,
          publicSlug: true,
          title: true,
          location: true,
          employmentType: true,
          status: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.savedJob.findMany({
        where: {
          candidateAccountId: account.id,
          vacancyId: { in: vacancyIds },
        },
        select: { vacancyId: true },
      }),
      this.prisma.application.findMany({
        where: {
          vacancyId: { in: vacancyIds },
          source: ApplicationSource.DIRECT,
          candidate: { candidateAccountId: account.id },
        },
        select: { vacancyId: true, status: true },
      }),
    ]);
    const vacancyById = new Map(vacancies.map((v) => [v.id, v]));
    const saved = new Set(savedJobs.map((s) => s.vacancyId));
    const applicationByVacancy = new Map(
      applications.map((a) => [a.vacancyId, a.status]),
    );

    const matches = result.matches.flatMap((match) => {
      const vacancy = vacancyById.get(match.vacancyId);
      if (!vacancy) return []; // closed/deleted since indexing — dropped
      return [
        {
          vacancy: {
            slug: vacancy.publicSlug,
            title: vacancy.title,
            organizationName: vacancy.organization.name,
            location: vacancy.location,
            employmentType: vacancy.employmentType,
            status: vacancy.status,
          },
          match: match.match,
          explanation: match.explanation,
          supportedRequirements: match.supportedRequirements,
          unsupportedRequirements: match.unsupportedRequirements,
          unclearRequirements: match.unclearRequirements,
          evidence: match.evidence,
          saved: saved.has(match.vacancyId),
          applicationState: applicationByVacancy.get(match.vacancyId) ?? null,
        },
      ];
    });

    return {
      matches,
      locale: result.locale,
      generated: result.generated,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Shared lookup used by PublicJobsService at apply time. */
  async requireAccount(userId: string) {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { userId },
    });
    if (!account) {
      throw new BadRequestException(
        'A candidate account is required. Create one via POST /candidate-account first.',
      );
    }
    return account;
  }

  /**
   * Scope for "my applications": linked through MY account AND submitted by me
   * (source DIRECT). Applications a recruiter created against the same person
   * are internal to that organization and stay invisible here.
   */
  private myApplicationsWhere(candidateAccountId: string) {
    return {
      source: ApplicationSource.DIRECT,
      candidate: { candidateAccountId },
    } satisfies Prisma.ApplicationWhereInput;
  }
}

const WITHDRAWABLE_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.NEW,
  ApplicationStatus.REVIEWING,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
];

/** Response shape for the profile. Internal linkage ids stay internal. */
const ACCOUNT_SELECT = {
  id: true,
  headline: true,
  location: true,
  phone: true,
  summary: true,
  skills: true,
  languages: true,
  experience: true,
  education: true,
  profileVisibility: true,
  resumeDocument: {
    select: {
      id: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
      createdAt: true,
    },
  },
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * What a candidate may see of their own application. Deliberately excludes
 * recruiter-side data (notes, evidence, other applicants, rankings).
 */
const CANDIDATE_APPLICATION_SELECT = {
  id: true,
  status: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  vacancy: {
    select: {
      publicSlug: true,
      title: true,
      location: true,
      employmentType: true,
      organization: { select: { name: true } },
    },
  },
  submittedDocument: { select: { originalFileName: true } },
} as const;

function toAccountData(dto: UpsertCandidateAccountDto) {
  return {
    ...(dto.headline !== undefined ? { headline: dto.headline } : {}),
    ...(dto.location !== undefined ? { location: dto.location } : {}),
    ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
    ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
    ...(dto.skills !== undefined ? { skills: dto.skills } : {}),
    ...(dto.languages !== undefined ? { languages: dto.languages } : {}),
    ...(dto.experience !== undefined
      ? { experience: dto.experience as unknown as Prisma.InputJsonValue }
      : {}),
    ...(dto.education !== undefined
      ? { education: dto.education as unknown as Prisma.InputJsonValue }
      : {}),
    ...(dto.profileVisibility !== undefined
      ? { profileVisibility: dto.profileVisibility }
      : {}),
  };
}

/**
 * Maps the canonical CandidateAccount profile onto the AI contract. The
 * experience/education JSON is DTO-validated at write time; reading stays
 * defensive anyway because JSON columns make no promises.
 */
function buildAiProfile(account: CandidateAccount): AiCandidateProfile {
  const experience = (
    Array.isArray(account.experience) ? account.experience : []
  ).flatMap((entry) => {
    const e = entry as {
      title?: unknown;
      company?: unknown;
      description?: unknown;
    };
    if (typeof e?.title !== 'string' || !e.title) return [];
    return [
      {
        title: e.title,
        company: typeof e.company === 'string' ? e.company : null,
        description: typeof e.description === 'string' ? e.description : null,
      },
    ];
  });
  const education = (
    Array.isArray(account.education) ? account.education : []
  ).flatMap((entry) => {
    const e = entry as {
      institution?: unknown;
      degree?: unknown;
      field?: unknown;
    };
    if (typeof e?.institution !== 'string' || !e.institution) return [];
    return [
      {
        institution: e.institution,
        degree: typeof e.degree === 'string' ? e.degree : null,
        field: typeof e.field === 'string' ? e.field : null,
      },
    ];
  });

  return {
    headline: account.headline,
    summary: account.summary,
    location: account.location,
    skills: account.skills,
    languages: account.languages,
    experience,
    education,
  };
}
