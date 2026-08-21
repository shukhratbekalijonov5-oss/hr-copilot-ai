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
  type JobMatchLabel,
  type SupportedLocale,
} from '../ai/ai-service.client';
import { JobMatchRankingService } from './job-match-ranking.service';
import { CandidateEvidenceLifecycleService } from '../candidate-evidence/candidate-evidence.service';
import { NO_CANDIDATE_EVIDENCE } from '../candidate-evidence/evidence-policy';

/**
 * Default matches per page.
 *
 * A page size, NOT a result cap: `total` always reports the full ranked count
 * and the client pages to the end. Twenty fills a first screen without making
 * the browser render a hundred heavy cards at once.
 */
const DEFAULT_MATCH_PAGE = 20;
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
    private readonly evidence: CandidateEvidenceLifecycleService,
    private readonly ranking: JobMatchRankingService,
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
    const account = await this.requireAccount(userId);
    const updated = await this.prisma.candidateAccount.update({
      where: { userId },
      data: toAccountData(dto),
      select: ACCOUNT_SELECT,
    });

    // The profile feeds the capability profile that ranking is built on —
    // headline, skills and experience all shape it — so an edit makes the
    // stored ranking describe a candidate who has since changed.
    //
    // Deliberately NOT an `evidenceRevision` bump: that counter means "the
    // files and links moved", and overloading it would make a headline edit
    // read as a change to someone's evidence.
    await this.ranking.invalidate(account.id);
    return updated;
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
          data: {
            resumeDocumentId: documentId,
            // Adding a file changes what the AI can see, so any Job Match
            // generated before this upload is no longer current.
            evidenceRevision: { increment: 1 },
          },
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
      // A REPLACED resume is a deleted source: the organization copies made
      // from it describe a file the candidate no longer stands behind, so they
      // go the same way a plain delete would send them. Old applications keep
      // their row, their status and their history — only the withdrawn
      // evidence disappears.
      await this.evidence.cascadeDerivedCopyRemoval(account.id, {
        fileId: previous.id,
      });
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

  /**
   * The caller's evidence state — the numbers every evidence-gated surface
   * needs, plus the revision they are at.
   *
   * `canRunJobMatch` is the SAME condition the backend enforces in
   * `jobMatches`, resolved in one place so the button and the endpoint can
   * never disagree about whether matching is possible.
   */
  async getEvidenceState(userId: string) {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { userId },
      select: { id: true, evidenceRevision: true },
    });
    if (!account) {
      return {
        hasAccount: false,
        files: 0,
        links: 0,
        total: 0,
        evidenceRevision: 0,
        canRunJobMatch: false,
      };
    }

    const counts = await this.evidence.activeSourceCounts(account.id);
    return {
      hasAccount: true,
      ...counts,
      evidenceRevision: account.evidenceRevision,
      canRunJobMatch: counts.total > 0,
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
   * Permanently deletes ONE of the caller's own personal documents, and
   * everything downstream of it.
   *
   * Guarantees, in order:
   *  1. Bytes first. If the storage delete fails nothing else has changed and
   *     the whole call errors — success is never reported while the private
   *     file bytes provably remain. The delete is idempotent, so retrying is
   *     always safe.
   *  2. The FULL cascade, in one transaction: this row, every organization
   *     copy derived from it (`sourceCandidateDocumentId`), the citations and
   *     requirement mappings built on those copies, and the account's evidence
   *     revision. If the deleted file was the primary resume the pointer moves
   *     to the newest remaining personal document, so applying keeps working
   *     from the survivors.
   *  3. Vectors and organization bytes last, idempotently. The processor
   *     re-checks existence after indexing, so a worker finishing AFTER this
   *     delete cannot resurrect anything.
   *
   * What survives: the account, the profile, the applications themselves with
   * their status, chat and history, saved jobs, and every OTHER source. What
   * does not: this file, anywhere in HR Copilot, including in the analysis a
   * recruiter was reading — a candidate's evidence is theirs to withdraw.
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

    // 2 & 3 — rows, derived copies, derived AI artifacts, then vectors.
    await this.evidence.cascadePersonalFileDeletion(account.id, document.id, {
      repointResumeTo:
        account.resumeDocumentId === document.id ? 'newest' : undefined,
    });

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

    // THE EVIDENCE GATE. Job Match is an evidence-grounded feature: it reports
    // what a candidate's files and links actually demonstrate against a
    // vacancy's requirements. With nothing submitted there is nothing to
    // ground it in, and matching on a headline and a skills list would be
    // exactly the invented analysis this product refuses to produce.
    //
    // Files and links count equally and independently — one portfolio link and
    // no resume is a perfectly good basis for matching. (Applying is a
    // separate rule with its own resume requirement; the two are deliberately
    // not the same gate.)
    const counts = await this.evidence.activeSourceCounts(account.id);
    if (counts.total === 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message:
          'Add a resume or a professional link before matching jobs — ' +
          'matching is grounded in your evidence, not your profile text.',
        code: NO_CANDIDATE_EVIDENCE,
      });
    }

    const generatedFromRevision = account.evidenceRevision;
    const allowedSourceIds = await this.evidence.activePersonalSourceIds(
      account.id,
    );

    const page = Math.max(1, dto.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, dto.limit ?? DEFAULT_MATCH_PAGE));

    // Reuse the stored ranking when it still describes the current inputs.
    // Paging must NEVER recompute: a fresh ranking between page 1 and page 2
    // could move a vacancy across the boundary and show it twice or not at all.
    const fingerprint = await this.ranking.vacancyFingerprint();
    let run = dto.refresh
      ? null
      : await this.ranking.currentRun(
          account.id,
          generatedFromRevision,
          fingerprint,
        );

    let computed: Awaited<
      ReturnType<JobMatchRankingService['computeRun']>
    > | null = null;
    if (!run) {
      computed = await this.ranking.computeRun({
        candidateAccountId: account.id,
        profile,
        locale,
        evidenceRevision: generatedFromRevision,
        allowedSourceIds,
        explainLimit: pageSize,
      });
      run = await this.ranking.currentRun(
        account.id,
        generatedFromRevision,
        computed.fingerprint,
      );
    }
    if (!run) {
      // The ranking was computed but immediately invalidated by a concurrent
      // evidence change. Reported as an empty page rather than a stale one.
      return this.emptyMatchPage(locale, generatedFromRevision, page, pageSize);
    }

    const entries = await this.ranking.page(
      run.id,
      (page - 1) * pageSize,
      pageSize,
    );

    // Public-facing vacancy fields, plus this candidate's own relationship to
    // each job. Only vacancies STILL open in the database are shown: a ranking
    // can outlive a vacancy being closed, and the database is the authority.
    const vacancyIds = entries.map((entry) => entry.vacancyId);
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
        // Newest first: a vacancy can hold several attempts, and the CURRENT
        // one is the newest.
        orderBy: { createdAt: 'desc' },
        select: { vacancyId: true, status: true },
      }),
    ]);
    const vacancyById = new Map(vacancies.map((v) => [v.id, v]));
    const saved = new Set(savedJobs.map((s) => s.vacancyId));
    const applicationByVacancy = new Map<string, ApplicationStatus>();
    for (const application of applications) {
      if (!applicationByVacancy.has(application.vacancyId)) {
        applicationByVacancy.set(application.vacancyId, application.status);
      }
    }

    // Prose for THIS page, written once and remembered per locale. Paging to
    // results 41-60 costs one small generation call, not a re-ranking.
    const { prose: explained, pending: explanationsPending } =
      await this.ranking.explainPage(entries, locale);

    const matches = entries.flatMap((entry) => {
      const vacancy = vacancyById.get(entry.vacancyId);
      if (!vacancy) return []; // closed since the ranking ran
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
          rank: entry.rank,
          score: entry.score,
          match: entry.tier as JobMatchLabel,
          signals: entry.signals as Record<string, number>,
          matchedSkills: entry.matchedSkills,
          missingSkills: entry.missingSkills,
          explanation: explained.get(entry.vacancyId) ?? null,
          supportedRequirements: entry.supportedRequirements as unknown[],
          unsupportedRequirements: entry.unsupportedRequirements as unknown[],
          unclearRequirements: entry.unclearRequirements as unknown[],
          evidence: entry.evidence as unknown[],
          saved: saved.has(entry.vacancyId),
          applicationState: applicationByVacancy.get(entry.vacancyId) ?? null,
        },
      ];
    });

    // Re-read AFTER computing. A deletion that landed while this was running
    // means the ranking describes evidence that no longer exists, so it is
    // reported stale rather than published as the current analysis.
    const currentRevision = await this.evidence.revision(account.id);
    const total = run.totalRanked;

    return {
      matches,
      locale,
      generated: matches.some((m) => m.explanation !== null),
      // True while prose for this page is still being written. Distinct from
      // `generated: false`, which means generation is not available at all.
      explanationsPending,
      generatedAt: run.generatedAt.toISOString(),
      evidenceRevision: generatedFromRevision,
      stale: currentRevision !== generatedFromRevision,
      page,
      limit: pageSize,
      // The FULL ranked count, so a client knows how far it can scroll. It is
      // deliberately not the length of this page.
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: page * pageSize < total,
      totalEligible: run.totalEligible,
      capability: run.capability ?? {},
    };
  }

  /** A well-formed empty page, for the rare recompute-then-invalidated race. */
  private emptyMatchPage(
    locale: SupportedLocale,
    evidenceRevision: number,
    page: number,
    limit: number,
  ) {
    return {
      matches: [],
      locale,
      generated: false,
      generatedAt: new Date().toISOString(),
      evidenceRevision,
      stale: true,
      explanationsPending: false,
      page,
      limit,
      total: 0,
      totalPages: 1,
      hasMore: false,
      totalEligible: 0,
      capability: {},
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
