import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { MembershipService } from '../common/membership/membership.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import {
  DomainEventsService,
  type ConversationMessageView,
} from '../common/events/domain-events.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { AccountType, ConversationParty } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { QueryConversationsDto } from './dto/query-conversations.dto';

/**
 * Vacancy-scoped interview chat.
 *
 * A conversation is NEVER created here on request: the only creation path is
 * `createForInvitationTx`, called inside the interview-invitation transaction
 * (see ApplicationsService.inviteToInterview). Guessing ids buys nothing —
 * every read/write below re-resolves the caller's lawful relationship to the
 * conversation from the live database:
 *
 *  - organization side: the conversation's organizationId must equal the
 *    caller's guard-validated active organization AND its vacancy must have
 *    been created by the caller (cross-tenant OR same-org non-creator ⇒ 404 —
 *    conversations were never org-browsable, so existence is not disclosed);
 *  - candidate side: the conversation's candidateAccount must belong to the
 *    calling user (foreign ⇒ 404, indistinguishable from non-existent).
 *
 * Messages are plain text, persisted until the vacancy closes, and are never
 * indexed into Qdrant nor sent to any AI service.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly memberships: MembershipService,
    private readonly events: DomainEventsService,
    private readonly ownedVacancies: OwnedVacancyService,
  ) {}

  // -- Lifecycle (called by other services inside THEIR transactions) -------

  /**
   * Creates — or returns the existing — conversation for one vacancy +
   * candidate-account pair. Idempotent by the (vacancyId, candidateAccountId)
   * unique constraint: two racing invitations converge on a single row (the
   * upsert compiles to INSERT .. ON CONFLICT).
   */
  async createForInvitationTx(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      vacancyId: string;
      candidateId: string;
      candidateAccountId: string;
    },
  ) {
    return tx.conversation.upsert({
      where: {
        vacancyId_candidateAccountId: {
          vacancyId: params.vacancyId,
          candidateAccountId: params.candidateAccountId,
        },
      },
      update: {},
      create: params,
      select: { id: true, vacancyId: true, createdAt: true },
    });
  }

  /**
   * HARD-DELETES every conversation (and, via FK cascade, every message) of a
   * vacancy. Must run inside the SAME transaction as the vacancy status
   * change so "vacancy CLOSED but chats visible" (or the reverse) is
   * unrepresentable. Returns the deleted ids so the caller can fan realtime
   * cleanup out AFTER commit.
   */
  purgeVacancyConversationsTx(
    tx: Prisma.TransactionClient,
    vacancyId: string,
  ): Promise<string[]> {
    return this.purgeConversationsTx(tx, { vacancyId });
  }

  /**
   * HARD-DELETES the conversation of ONE candidate on ONE vacancy — the
   * per-application counterpart of the vacancy purge, sharing its
   * implementation so the triggers can never drift apart. Used by every
   * transition that ends a SINGLE hiring relationship: rejecting the
   * candidate, and deleting the application row outright.
   *
   * Scoped by (vacancyId, candidateId), which is exactly the pair the
   * application names: another candidate on the same vacancy, the same
   * candidate on another vacancy, and every other organization are all
   * structurally out of reach. Runs inside the caller's transaction, so
   * "pipeline record gone but the chat still answers" is unrepresentable.
   */
  purgeCandidateVacancyConversationTx(
    tx: Prisma.TransactionClient,
    params: { vacancyId: string; candidateId: string },
  ): Promise<string[]> {
    return this.purgeConversationsTx(tx, {
      vacancyId: params.vacancyId,
      candidateId: params.candidateId,
    });
  }

  /**
   * The single hard-deletion implementation. Messages are removed explicitly
   * before their conversations: the FK cascade would do it anyway, but stating
   * it here keeps the permanent-deletion invariant visible in the code that
   * owns it rather than resting on a schema detail.
   */
  private async purgeConversationsTx(
    tx: Prisma.TransactionClient,
    where: Prisma.ConversationWhereInput,
  ): Promise<string[]> {
    const rows = await tx.conversation.findMany({
      where,
      select: { id: true },
    });
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    await tx.conversationMessage.deleteMany({
      where: { conversationId: { in: ids } },
    });
    await tx.conversation.deleteMany({ where: { id: { in: ids } } });
    return ids;
  }

  // -- Organization side -----------------------------------------------------

  /**
   * HR interview chats under the vacancy-scoped workspace rule: only
   * conversations of vacancies the CALLER PERSONALLY CREATED, whether or not
   * an explicit vacancyId filter is given. Same-org colleagues' conversations
   * are never listed. An explicit vacancyId is resolved through the owned
   * -vacancy policy FIRST so the caller gets the honest 403/404 instead of a
   * silently empty page.
   */
  async listForOrganization(
    organizationId: string,
    userId: string,
    query: QueryConversationsDto,
  ): Promise<PaginatedResult<unknown>> {
    if (query.vacancyId) {
      await this.ownedVacancies.requireOwned(
        userId,
        organizationId,
        query.vacancyId,
      );
    }
    const where: Prisma.ConversationWhereInput = {
      ...this.tenant.scope(organizationId),
      // Creator scoping, unconditional — never rely on the client filter.
      vacancy: { createdById: userId },
      ...(query.vacancyId ? { vacancyId: query.vacancyId } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { updatedAt: 'desc' },
        select: ORG_CONVERSATION_SELECT,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return paginated(data, total, query.page, query.limit);
  }

  /**
   * Conversations were never org-browsable, so — unlike vacancies, where a
   * same-org non-creator gets an honest 403 — a conversation of a colleague's
   * vacancy is a plain 404, indistinguishable from non-existent. Guessing a
   * conversation id buys nothing.
   */
  async getForOrganization(
    organizationId: string,
    userId: string,
    conversationId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ...this.tenant.scope(organizationId),
        vacancy: { createdById: userId },
      },
      select: ORG_CONVERSATION_SELECT,
    });
    return this.tenant.assertFound(conversation, 'Conversation');
  }

  async listMessagesForOrganization(
    organizationId: string,
    userId: string,
    conversationId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<ConversationMessageView>> {
    await this.getForOrganization(organizationId, userId, conversationId);
    return this.listMessages(conversationId, query);
  }

  async sendMessageAsOrganization(
    organizationId: string,
    senderUserId: string,
    conversationId: string,
    content: string,
  ): Promise<ConversationMessageView> {
    await this.getForOrganization(organizationId, senderUserId, conversationId);
    return this.persistMessage(
      conversationId,
      senderUserId,
      ConversationParty.ORGANIZATION,
      content,
    );
  }

  // -- Candidate side --------------------------------------------------------

  async listForCandidate(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const account = await this.requireCandidateAccount(userId);
    const where: Prisma.ConversationWhereInput = {
      candidateAccountId: account.id,
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { updatedAt: 'desc' },
        select: CANDIDATE_CONVERSATION_SELECT,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return paginated(data, total, query.page, query.limit);
  }

  async getForCandidate(userId: string, conversationId: string) {
    const account = await this.requireCandidateAccount(userId);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, candidateAccountId: account.id },
      select: CANDIDATE_CONVERSATION_SELECT,
    });
    // Foreign (another candidate's) conversation is indistinguishable from a
    // non-existent one.
    return this.tenant.assertFound(conversation, 'Conversation');
  }

  async listMessagesForCandidate(
    userId: string,
    conversationId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<ConversationMessageView>> {
    await this.getForCandidate(userId, conversationId);
    return this.listMessages(conversationId, query);
  }

  async sendMessageAsCandidate(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<ConversationMessageView> {
    await this.getForCandidate(userId, conversationId);
    return this.persistMessage(
      conversationId,
      userId,
      ConversationParty.CANDIDATE,
      content,
    );
  }

  // -- Socket authorization --------------------------------------------------

  /**
   * Resolves which side (if any) of a conversation the user lawfully is, LIVE
   * from the database — exactly the checks the REST guard chain performs, so
   * a revoked membership or deleted account loses socket access on its next
   * action. Client-supplied ids are never trusted beyond being looked up.
   */
  async resolveConversationAccess(
    userId: string,
    conversationId: string,
  ): Promise<ConversationParty | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, accountType: true },
    });
    if (!user) return null;

    if (user.accountType === AccountType.CANDIDATE) {
      const owned = await this.prisma.conversation.findFirst({
        where: { id: conversationId, candidateAccount: { userId } },
        select: { id: true },
      });
      return owned ? ConversationParty.CANDIDATE : null;
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        organizationId: true,
        vacancy: { select: { createdById: true } },
      },
    });
    if (!conversation) return null;
    // Vacancy creator only — organization membership alone no longer grants
    // access to a colleague's interview conversations (REST and socket agree).
    if (conversation.vacancy.createdById !== userId) return null;
    const membership = await this.memberships.findMembership(
      userId,
      conversation.organizationId,
    );
    if (!membership) return null;
    if (membership.user.accountType !== AccountType.ORGANIZATION) return null;
    return ConversationParty.ORGANIZATION;
  }

  /** Socket send: authorize live, then persist through the same path as REST. */
  async sendMessageFromSocket(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<ConversationMessageView | null> {
    const party = await this.resolveConversationAccess(userId, conversationId);
    if (!party) return null;
    return this.persistMessage(conversationId, userId, party, content);
  }

  // -- Internals -------------------------------------------------------------

  private async listMessages(
    conversationId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<ConversationMessageView>> {
    const where = { conversationId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.conversationMessage.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'asc' },
        select: MESSAGE_SELECT,
      }),
      this.prisma.conversationMessage.count({ where }),
    ]);
    return paginated(rows.map(toMessageView), total, query.page, query.limit);
  }

  private async persistMessage(
    conversationId: string,
    senderUserId: string,
    senderParty: ConversationParty,
    content: string,
  ): Promise<ConversationMessageView> {
    let view: ConversationMessageView;
    try {
      const row = await this.prisma.conversationMessage.create({
        data: { conversationId, senderUserId, senderParty, content },
        select: MESSAGE_SELECT,
      });
      // Bump the conversation so "most recently active first" orderings work.
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      view = toMessageView(row);
    } catch (error) {
      // The conversation was hard-deleted between the access check and the
      // write (vacancy closed concurrently): FK violation / row gone. The
      // conversation no longer exists — report exactly that.
      const code = (error as { code?: string })?.code;
      if (code === 'P2003' || code === 'P2025') {
        throw new NotFoundException('Conversation not found');
      }
      throw error;
    }

    this.events.publish('chat.message.created', {
      conversationId,
      message: view,
      senderUserId,
    });
    return view;
  }

  private async requireCandidateAccount(userId: string) {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Candidate account not found');
    return account;
  }
}

/** What HR may see: pipeline context, never the candidate's private profile. */
const ORG_CONVERSATION_SELECT = {
  id: true,
  vacancyId: true,
  createdAt: true,
  updatedAt: true,
  vacancy: { select: { id: true, title: true, status: true } },
  candidate: { select: { id: true, fullName: true, email: true } },
} as const;

/** What the candidate may see: the job advertisement context, nothing internal. */
const CANDIDATE_CONVERSATION_SELECT = {
  id: true,
  createdAt: true,
  updatedAt: true,
  vacancy: {
    select: {
      publicSlug: true,
      title: true,
      status: true,
      organization: { select: { name: true } },
    },
  },
} as const;

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderParty: true,
  content: true,
  createdAt: true,
  sender: { select: { fullName: true } },
} as const;

function toMessageView(row: {
  id: string;
  conversationId: string;
  senderParty: ConversationParty;
  content: string;
  createdAt: Date;
  sender: { fullName: string };
}): ConversationMessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderParty: row.senderParty,
    senderName: row.sender.fullName,
    content: row.content,
    createdAt: row.createdAt,
  };
}
