import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { ChatService } from '../chat/chat.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { APPLICANT_APPLICATION_SCOPE } from '../common/vacancy-access/applicant-scope';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { ApplicationStatus, VacancyStatus } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { QueryApplicationsDto } from './dto/query-applications.dto';

export interface InviteToInterviewResult {
  application: unknown;
  conversation: { id: string; vacancyId: string; createdAt: Date };
}

/**
 * Applications carry no organizationId column of their own — they inherit
 * tenancy from both the vacancy and the candidate. Every query therefore
 * filters through those relations.
 *
 * There is no create method: an application row is written by
 * PublicJobsService.apply when a candidate applies, and by nothing else. This
 * service is the recruiter's read/transition surface over what arrived, and
 * every query additionally requires a genuine applicant association
 * (APPLICANT_APPLICATION_SCOPE) — historical recruiter-made associations are
 * outside the active workflow and answer 404 like any other unknown id.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly chat: ChatService,
    private readonly events: DomainEventsService,
    private readonly ownedVacancies: OwnedVacancyService,
  ) {}

  async findAll(
    organizationId: string,
    query: QueryApplicationsDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ApplicationWhereInput = {
      // Tenancy through the relations + applicant-only, unconditionally.
      ...this.applicantScope(organizationId),
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
        ...this.applicantScope(organizationId),
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
    userId: string,
    id: string,
    status: ApplicationStatus,
  ) {
    if (status === ApplicationStatus.INTERVIEW) {
      const result = await this.inviteToInterview(organizationId, userId, id);
      return result.application;
    }

    const application = this.tenant.assertFound(
      await this.prisma.application.findFirst({
        where: {
          id,
          ...this.applicantScope(organizationId),
        },
        select: {
          id: true,
          vacancyId: true,
          status: true,
          candidate: { select: { id: true, candidateAccountId: true } },
        },
      }),
      'Application',
    );
    // Pipeline stages belong to the vacancy's creator, like every other
    // vacancy-context mutation.
    await this.ownedVacancies.requireOwned(
      userId,
      organizationId,
      application.vacancyId,
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
        // Guaranteed by the applicant scope this application was read under.
        candidateAccountId: application.candidate.candidateAccountId!,
        deletedConversationId: deletedConversationIds[0] ?? null,
        // Consumers gate on the genuine transition: a REJECTED → REJECTED
        // re-save purges nothing new and must not re-notify the candidate.
        previousStatus: application.status,
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
   * Every applicant reachable here owns the CandidateAccount they applied
   * with, so the conversation is always created — there is no accountless
   * candidate left in the recruiter workflow to special-case.
   */
  async inviteToInterview(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<InviteToInterviewResult> {
    const application = this.tenant.assertFound(
      await this.prisma.application.findFirst({
        where: {
          id,
          ...this.applicantScope(organizationId),
        },
        select: {
          id: true,
          status: true,
          vacancy: { select: { id: true, status: true } },
          candidate: { select: { id: true, candidateAccountId: true } },
        },
      }),
      'Application',
    );
    const { vacancy, candidate } = application;
    // Only the vacancy's creator may invite to interview (and thereby unlock
    // a conversation) on it.
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancy.id);

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

        // Guaranteed by the applicant scope this application was read under.
        const created = await this.chat.createForInvitationTx(tx, {
          organizationId,
          vacancyId: vacancy.id,
          candidateId: candidate.id,
          candidateAccountId: candidate.candidateAccountId!,
        });

        return { updated: updatedApplication, conversation: created };
      },
    );

    this.events.publish('interview.invited', {
      organizationId,
      vacancyId: vacancy.id,
      applicationId: id,
      candidateId: candidate.id,
      candidateAccountId: candidate.candidateAccountId!,
      conversationId: conversation.id,
      actorUserId: userId,
      // A re-invite is idempotent (INTERVIEW → INTERVIEW); consumers use this
      // to notify only on the genuine transition.
      previousStatus: application.status,
    });

    return { application: updated, conversation };
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
  async remove(organizationId: string, userId: string, id: string) {
    const application = this.tenant.assertFound(
      await this.prisma.application.findFirst({
        where: {
          id,
          ...this.applicantScope(organizationId),
        },
        select: { id: true, vacancyId: true, candidateId: true },
      }),
      'Application',
    );
    await this.ownedVacancies.requireOwned(
      userId,
      organizationId,
      application.vacancyId,
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

  /**
   * The two filters every single-application lookup runs under: tenancy
   * through BOTH parents, and a genuine applicant association. Composed here
   * so no route can accidentally reach a historical recruiter-made row — such
   * an id simply is not found, exactly like a foreign one.
   */
  private applicantScope(organizationId: string): Prisma.ApplicationWhereInput {
    return {
      vacancy: this.tenant.scope(organizationId),
      candidate: {
        ...this.tenant.scope(organizationId),
        ...APPLICANT_APPLICATION_SCOPE.candidate,
      },
      source: APPLICANT_APPLICATION_SCOPE.source,
    };
  }
}
