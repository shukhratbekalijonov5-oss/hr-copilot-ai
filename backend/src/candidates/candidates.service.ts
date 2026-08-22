import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { StorageService } from '../storage/storage.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { APPLICANT_CANDIDATE_SCOPE } from '../common/vacancy-access/applicant-scope';
import { signAvatarUrl } from '../account/avatar-url';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { ApplicationSource } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { UpdateCandidateDto } from './dto/update-candidate.dto';
import type { QueryCandidatesDto } from './dto/query-candidates.dto';

/**
 * Candidate records only. There is deliberately no scoring, ranking or
 * shortlisting logic here: this service stores what the applicant and the
 * parser provide, and hiring decisions stay with the HR user.
 *
 * There is NO create method. Candidate records come into existence exactly one
 * way — a CandidateAccount applies to an OPEN vacancy — so this service reads,
 * edits and deletes what that flow produced.
 *
 * Every read is filtered to real applicants (APPLICANT_CANDIDATE_SCOPE):
 * records left behind by the removed recruiter-created-candidate feature keep
 * their rows but are not part of the working candidate universe any more.
 */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly ownedVacancies: OwnedVacancyService,
    private readonly storage: StorageService,
  ) {}

  async findAll(
    organizationId: string,
    query: QueryCandidatesDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CandidateWhereInput = {
      ...this.tenant.scope(organizationId),
      ...APPLICANT_CANDIDATE_SCOPE,
      ...(query.location ? { location: query.location } : {}),
      ...(query.currentTitle
        ? {
            currentTitle: { contains: query.currentTitle, mode: 'insensitive' },
          }
        : {}),
      ...(query.minExperienceYears !== undefined
        ? { totalExperienceYears: { gte: query.minExperienceYears } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { currentTitle: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.candidate.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { applications: true, evidence: true } },
          // The LIVE account: current name/email/avatar and the CURRENT
          // personal documents. There are no org-side copies to count any
          // more — what a recruiter sees in a row is what the person holds
          // right now.
          candidateAccount: {
            select: {
              user: {
                select: {
                  fullName: true,
                  email: true,
                  avatarStorageKey: true,
                },
              },
              personalDocuments: { select: { status: true } },
            },
          },
        },
      }),
      this.prisma.candidate.count({ where }),
    ]);

    return paginated(
      await Promise.all(data.map((row) => this.toLiveRow(row))),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * Overlays the LIVE account identity and CURRENT evidence facts onto an
   * org-side candidate row. The org row remains the pipeline anchor (and
   * keeps recruiter-enriched fields like phone/location/title), but the
   * person's name, email, avatar and document set are the account's and
   * always current.
   */
  private async toLiveRow<
    T extends {
      fullName: string;
      email: string | null;
      candidateAccount: {
        user: {
          fullName: string;
          email: string;
          avatarStorageKey: string | null;
        };
        personalDocuments: { status: string }[];
      } | null;
    },
  >(row: T) {
    const { candidateAccount, ...candidate } = row;
    const user = candidateAccount?.user;
    const statuses = (candidateAccount?.personalDocuments ?? []).map(
      (document) => document.status,
    );
    return {
      ...candidate,
      fullName: user?.fullName ?? candidate.fullName,
      email: user?.email ?? candidate.email,
      avatarUrl: await signAvatarUrl(
        this.storage,
        user?.avatarStorageKey ?? null,
      ),
      documentCount: statuses.length,
      documentStatuses: statuses,
    };
  }

  /**
   * One applicant: the org-side pipeline record with their applications,
   * overlaid with the LIVE account identity.
   *
   * There are deliberately NO documents and NO links here. Since the snapshot
   * model was removed, the candidate's evidence exists in exactly one place —
   * their account — and recruiters read it through the vacancy-contextual
   * `getCurrentEvidence` / `getCurrentDocumentDownload` endpoints, which
   * verify the full authorization chain per request. One evidence API, not
   * two competing ones.
   */
  async findOne(organizationId: string, id: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: {
        id,
        ...this.tenant.scope(organizationId),
        ...APPLICANT_CANDIDATE_SCOPE,
      },
      include: {
        applications: {
          // Only the applications this person actually submitted; a historical
          // recruiter-made association is not part of their pipeline.
          where: { source: ApplicationSource.DIRECT },
          include: {
            vacancy: { select: { id: true, title: true, status: true } },
          },
        },
        candidateAccount: {
          select: {
            user: {
              select: { fullName: true, email: true, avatarStorageKey: true },
            },
            personalDocuments: { select: { status: true } },
          },
        },
      },
    });
    return this.toLiveRow(this.tenant.assertFound(candidate, 'Candidate'));
  }

  async update(organizationId: string, id: string, dto: UpdateCandidateDto) {
    await this.assertCandidateInOrg(organizationId, id);
    return this.prisma.candidate.update({ where: { id }, data: dto });
  }

  async remove(organizationId: string, id: string) {
    await this.assertCandidateInOrg(organizationId, id);
    await this.prisma.candidate.delete({ where: { id } });
    return { id, deleted: true };
  }

  /**
   * The applicant's CURRENT profile and evidence — live account data, not the
   * application-time copies findOne returns.
   *
   * Authorization is the full vacancy-contextual chain, every hop derived
   * server-side from the session:
   *
   *   authenticated user -> vacancy OWNED by that user (requireOwned)
   *                      -> candidate LEGITIMATELY APPLIED to that vacancy
   *                         (assertCandidateInVacancy: DIRECT application from
   *                         an account-backed candidate)
   *                      -> read-only view of that account's current data
   *
   * A candidate id alone grants nothing; neither does an org id or any
   * client-supplied owner id. One application is enough — several attempts to
   * the same vacancy (reapply) establish the same single relationship, and
   * the evidence below is account-level, so attempt count can never duplicate
   * a document or a link.
   *
   * What is read is exactly what the candidate's own My Profile shows for
   * these sections: the user's name/email/avatar, ALL personal documents
   * (organizationId NULL, up to the 3-file cap) and ALL professional links
   * (up to 3), at their current processing status. What is deliberately NOT
   * exposed: storage keys, normalized URLs, extracted link sections, and any
   * account-internal field the product does not already show to recruiters.
   * Deleted evidence simply is not there — these queries read live rows.
   */
  async getCurrentEvidence(
    userId: string,
    organizationId: string,
    candidateId: string,
    vacancyId: string,
  ) {
    const account = await this.requireApplicantAccount(
      userId,
      organizationId,
      candidateId,
      vacancyId,
    );

    const [user, documents, links] = await this.prisma.$transaction([
      this.prisma.user.findUniqueOrThrow({
        where: { id: account.userId },
        select: { fullName: true, email: true, avatarStorageKey: true },
      }),
      this.prisma.document.findMany({
        where: { candidateAccountId: account.id, organizationId: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          originalFileName: true,
          mimeType: true,
          fileSize: true,
          type: true,
          status: true,
          pageCount: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.candidateLink.findMany({
        where: { candidateAccountId: account.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          url: true,
          title: true,
          detectedType: true,
          status: true,
          lastFetchedAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      candidate: {
        id: candidateId,
        fullName: user.fullName,
        email: user.email,
        avatarUrl: await signAvatarUrl(this.storage, user.avatarStorageKey),
      },
      documents: documents.map((document) => ({
        id: document.id,
        fileName: document.originalFileName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
        sourceType: document.type,
        status: document.status,
        pageCount: document.pageCount,
        uploadedAt: document.createdAt,
        updatedAt: document.updatedAt,
      })),
      professionalLinks: links.map((link) => ({
        id: link.id,
        title: link.title,
        url: link.url,
        sourceType: link.detectedType,
        status: link.status,
        analysedAt: link.lastFetchedAt,
        updatedAt: link.updatedAt,
      })),
    };
  }

  /**
   * Short-lived signed URL for ONE of the applicant's CURRENT documents.
   *
   * Same authorization chain as getCurrentEvidence, then the document id must
   * belong to exactly that candidate's account RIGHT NOW and be a personal
   * document (organizationId NULL). A substituted document id — another
   * candidate's file, an org-side copy, a deleted file — is an
   * indistinguishable 404. The storage key never leaves the backend; the URL
   * is minted by the same StorageService used everywhere else and expires on
   * its existing schedule.
   */
  async getCurrentDocumentDownload(
    userId: string,
    organizationId: string,
    candidateId: string,
    vacancyId: string,
    documentId: string,
  ) {
    const account = await this.requireApplicantAccount(
      userId,
      organizationId,
      candidateId,
      vacancyId,
    );

    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        candidateAccountId: account.id,
        organizationId: null,
      },
      select: { storageKey: true, originalFileName: true, mimeType: true },
    });
    if (!document) throw new NotFoundException('Document not found');

    return {
      url: await this.storage.getSignedUrl(document.storageKey),
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
    };
  }

  /**
   * The shared gate for current-evidence reads: owned vacancy, legitimate
   * applicant, tenancy, and a resolvable live account. Returns the account so
   * callers query live data by ITS id — never by anything the client sent.
   */
  private async requireApplicantAccount(
    userId: string,
    organizationId: string,
    candidateId: string,
    vacancyId: string,
  ): Promise<{ id: string; userId: string }> {
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);
    await this.ownedVacancies.assertCandidateInVacancy(vacancyId, candidateId);

    const candidate = await this.prisma.candidate.findFirst({
      where: {
        id: candidateId,
        ...this.tenant.scope(organizationId),
        ...APPLICANT_CANDIDATE_SCOPE,
      },
      select: {
        candidateAccount: { select: { id: true, userId: true } },
      },
    });
    // The applicant scope guarantees candidateAccountId, but the account row
    // itself can be gone (account deletion cascades differently from the
    // org-side record). No account means no current evidence to show.
    if (!candidate?.candidateAccount) {
      throw new NotFoundException('Candidate not found');
    }
    return candidate.candidateAccount;
  }

  /** Shared applicant + tenancy check reused by other modules. */
  async assertCandidateInOrg(organizationId: string, id: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: {
        id,
        ...this.tenant.scope(organizationId),
        ...APPLICANT_CANDIDATE_SCOPE,
      },
      select: { id: true },
    });
    return this.tenant.assertFound(candidate, 'Candidate');
  }
}
