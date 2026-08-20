import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { ChatService } from '../chat/chat.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { ApplicationStatus, VacancyStatus } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { CreateApplicationDto } from './dto/create-application.dto';
import type { QueryApplicationsDto } from './dto/query-applications.dto';

/** Why the invitation could not unlock a chat. */
export type ChatUnavailableReason = 'NO_CANDIDATE_ACCOUNT';

export interface InviteToInterviewResult {
  application: unknown;
  /** null when no chat could be unlocked — see chatUnavailableReason. */
  conversation: { id: string; vacancyId: string; createdAt: Date } | null;
  chatAvailable: boolean;
  chatUnavailableReason?: ChatUnavailableReason;
}

/**
 * Applications carry no organizationId column of their own — they inherit
 * tenancy from both the vacancy and the candidate. Every query therefore
 * filters through those relations, and creation verifies that BOTH parents
 * belong to the caller's organization before linking them.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly chat: ChatService,
    private readonly events: DomainEventsService,
  ) {}

  async create(organizationId: string, dto: CreateApplicationDto) {
    const [vacancy, candidate] = await Promise.all([
      this.prisma.vacancy.findFirst({
        where: { id: dto.vacancyId, ...this.tenant.scope(organizationId) },
        select: { id: true },
      }),
      this.prisma.candidate.findFirst({
        where: { id: dto.candidateId, ...this.tenant.scope(organizationId) },
        select: { id: true },
      }),
    ]);

    this.tenant.assertFound(vacancy, 'Vacancy');
    this.tenant.assertFound(candidate, 'Candidate');

    const existing = await this.prisma.application.findUnique({
      where: {
        vacancyId_candidateId: {
          vacancyId: dto.vacancyId,
          candidateId: dto.candidateId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Candidate is already attached to this vacancy',
      );
    }

    return this.prisma.application.create({
      data: {
        vacancyId: dto.vacancyId,
        candidateId: dto.candidateId,
        status: dto.status ?? ApplicationStatus.NEW,
      },
      include: {
        vacancy: { select: { id: true, title: true, status: true } },
        candidate: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async findAll(
    organizationId: string,
    query: QueryApplicationsDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ApplicationWhereInput = {
      // Tenancy through the relations, applied unconditionally.
      vacancy: this.tenant.scope(organizationId),
      candidate: this.tenant.scope(organizationId),
      ...(query.vacancyId ? { vacancyId: query.vacancyId } : {}),
      ...(query.candidateId ? { candidateId: query.candidateId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          vacancy: { select: { id: true, title: true, status: true } },
          candidate: {
            select: {
              id: true,
              fullName: true,
              email: true,
              currentTitle: true,
            },
          },
        },
      }),
      this.prisma.application.count({ where }),
    ]);

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(organizationId: string, id: string) {
    const application = await this.prisma.application.findFirst({
      where: {
        id,
        vacancy: this.tenant.scope(organizationId),
        candidate: this.tenant.scope(organizationId),
      },
      include: {
        vacancy: { include: { requirements: true } },
        candidate: {
          include: {
            documents: {
              select: {
                id: true,
                type: true,
                originalFileName: true,
                status: true,
                pageCount: true,
              },
            },
          },
        },
      },
    });
    return this.tenant.assertFound(application, 'Application');
  }

  /**
   * Human-controlled stage change. Any status is reachable from any other —
   * HR may reopen, withdraw or correct a mistake — but only a person can
   * trigger it. No automated caller invokes this method.
   *
   * Two statuses carry side effects, centralized HERE so no route can bypass
   * them — this method is the ONLY path into either status:
   *
   *  - INTERVIEW routes through the full invitation transition, which
   *    idempotently unlocks the interview conversation;
   *  - REJECTED ends the hiring relationship, so it HARD-DELETES that
   *    candidate's conversation on that vacancy (with every message) in the
   *    same transaction as the status change. Rejecting before an interview
   *    simply finds nothing to delete. A rejection never creates a chat, and
   *    never touches another candidate's, another vacancy's or another
   *    organization's.
   */
  async updateStatus(
    organizationId: string,
    id: string,
    status: ApplicationStatus,
  ) {
    if (status === ApplicationStatus.INTERVIEW) {
      const result = await this.inviteToInterview(organizationId, id);
      return result.application;
    }

    const application = this.tenant.assertFound(
      await this.prisma.application.findFirst({
        where: {
          id,
          vacancy: this.tenant.scope(organizationId),
          candidate: this.tenant.scope(organizationId),
        },
        select: {
          id: true,
          vacancyId: true,
          candidate: { select: { id: true, candidateAccountId: true } },
        },
      }),
      'Application',
    );

    const rejecting = status === ApplicationStatus.REJECTED;

    // One transaction for the whole transition: a failed purge rolls the
    // status back with it, so REJECTED-with-a-live-chat (and its mirror,
    // chat-deleted-but-still-in-pipeline) can never be observed.
    let deletedConversationIds: string[] = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.application.update({
        where: { id },
        data: { status },
        include: {
          vacancy: { select: { id: true, title: true } },
          candidate: { select: { id: true, fullName: true } },
        },
      });
      if (rejecting) {
        deletedConversationIds =
          await this.chat.purgeCandidateVacancyConversationTx(tx, {
            vacancyId: application.vacancyId,
            candidateId: application.candidate.id,
          });
      }
      return row;
    });

    if (rejecting) {
      // After commit: the rows are already gone, so a client that misses the
      // realtime event still cannot read or send — every request re-checks.
      if (deletedConversationIds.length > 0) {
        this.events.publish('chat.conversations.deleted', {
          vacancyId: application.vacancyId,
          reason: 'CANDIDATE_REJECTED',
          vacancyStatus: null,
          conversationIds: deletedConversationIds,
        });
      }
      this.events.publish('application.rejected', {
        organizationId,
        vacancyId: application.vacancyId,
        applicationId: id,
        candidateId: application.candidate.id,
        candidateAccountId: application.candidate.candidateAccountId,
        deletedConversationId: deletedConversationIds[0] ?? null,
      });
    }
    return updated;
  }

  /**
   * The interview invitation — THE only conversation-creating transition in
   * the system.
   *
   * Validates (all under the caller's organization scope, live):
   *  1. the application belongs to the caller's organization through BOTH
   *     parents (vacancy and candidate);
   *  2. the vacancy is still live — a CLOSED/ARCHIVED vacancy must never
   *     spawn a conversation, or the close-deletes-chats invariant could be
   *     bypassed trivially.
   *
   * Then, in ONE transaction: the pipeline moves to the existing INTERVIEW
   * status and the conversation is upserted on its (vacancyId,
   * candidateAccountId) unique key — so a double-click, a retry or two racing
   * requests all converge on exactly one conversation.
   *
   * Manual/external candidates (no platform CandidateAccount) are inviteable
   * — the pipeline still transitions — but no conversation is fabricated and
   * no account is invented: the response reports chatAvailable=false with
   * NO_CANDIDATE_ACCOUNT so the frontend can say exactly why.
   */
  async inviteToInterview(
    organizationId: string,
    id: string,
  ): Promise<InviteToInterviewResult> {
    const application = this.tenant.assertFound(
      await this.prisma.application.findFirst({
        where: {
          id,
          vacancy: this.tenant.scope(organizationId),
          candidate: this.tenant.scope(organizationId),
        },
        select: {
          id: true,
          vacancy: { select: { id: true, status: true } },
          candidate: { select: { id: true, candidateAccountId: true } },
        },
      }),
      'Application',
    );
    const { vacancy, candidate } = application;

    if (
      vacancy.status === VacancyStatus.CLOSED ||
      vacancy.status === VacancyStatus.ARCHIVED
    ) {
      throw new ConflictException(
        `Candidates cannot be invited to interview on a ${vacancy.status} vacancy`,
      );
    }

    const { updated, conversation } = await this.prisma.$transaction(
      async (tx) => {
        const updatedApplication = await tx.application.update({
          where: { id },
          data: { status: ApplicationStatus.INTERVIEW },
          include: {
            vacancy: { select: { id: true, title: true } },
            candidate: { select: { id: true, fullName: true } },
          },
        });

        const created = candidate.candidateAccountId
          ? await this.chat.createForInvitationTx(tx, {
              organizationId,
              vacancyId: vacancy.id,
              candidateId: candidate.id,
              candidateAccountId: candidate.candidateAccountId,
            })
          : null;

        return { updated: updatedApplication, conversation: created };
      },
    );

    this.events.publish('interview.invited', {
      organizationId,
      vacancyId: vacancy.id,
      applicationId: id,
      candidateId: candidate.id,
      candidateAccountId: candidate.candidateAccountId,
      conversationId: conversation?.id ?? null,
    });

    return {
      application: updated,
      conversation,
      chatAvailable: conversation !== null,
      ...(conversation
        ? {}
        : { chatUnavailableReason: 'NO_CANDIDATE_ACCOUNT' as const }),
    };
  }

  /**
   * Permanently removes one application — and with it the interview chat that
   * only existed because of that hiring relationship.
   *
   * A Conversation has no foreign key to Application (it hangs off the vacancy
   * and the candidate), so deleting the row here would otherwise leave an
   * orphan chat both sides could keep using with no pipeline record behind it.
   * The purge is the same shared helper rejection uses, scoped to exactly
   * (vacancyId, candidateId): another candidate on this vacancy, this
   * candidate on another vacancy, and other organizations are untouched.
   *
   * An application that never reached interview simply has nothing to purge —
   * that is the normal case, not an error.
   */
  async remove(organizationId: string, id: string) {
    const application = this.tenant.assertFound(
      await this.prisma.application.findFirst({
        where: {
          id,
          vacancy: this.tenant.scope(organizationId),
          candidate: this.tenant.scope(organizationId),
        },
        select: { id: true, vacancyId: true, candidateId: true },
      }),
      'Application',
    );

    // One transaction: a failed purge rolls the deletion back, so neither
    // "application gone, chat alive" nor "chat gone, application alive" is
    // observable.
    let deletedConversationIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      deletedConversationIds =
        await this.chat.purgeCandidateVacancyConversationTx(tx, {
          vacancyId: application.vacancyId,
          candidateId: application.candidateId,
        });
      await tx.application.delete({ where: { id } });
    });

    // After commit, and only if a conversation actually existed.
    if (deletedConversationIds.length > 0) {
      this.events.publish('chat.conversations.deleted', {
        vacancyId: application.vacancyId,
        reason: 'APPLICATION_DELETED',
        vacancyStatus: null,
        conversationIds: deletedConversationIds,
      });
    }
    return { id, deleted: true };
  }
}
