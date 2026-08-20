import { NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { TenantService } from '../common/tenant/tenant.service';
import { AccountType, ConversationParty } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import type { MembershipService } from '../common/membership/membership.service';
import type { DomainEventsService } from '../common/events/domain-events.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function createPrismaMock() {
  const mock = {
    conversation: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    conversationMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    candidateAccount: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(
    (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof arg === 'function' ? arg(mock) : Promise.all(arg),
  );
  return mock;
}

describe('ChatService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let memberships: { findMembership: jest.Mock };
  let events: { publish: jest.Mock };
  let service: ChatService;

  beforeEach(() => {
    prisma = createPrismaMock();
    memberships = { findMembership: jest.fn() };
    events = { publish: jest.fn() };
    service = new ChatService(
      prisma as unknown as PrismaService,
      new TenantService(),
      memberships as unknown as MembershipService,
      events as unknown as DomainEventsService,
    );
  });

  describe('createForInvitationTx — exactly one conversation per pair', () => {
    it('upserts on the (vacancyId, candidateAccountId) unique key', async () => {
      prisma.conversation.upsert.mockResolvedValue({ id: 'conv-1' });

      await service.createForInvitationTx(prisma as never, {
        organizationId: ORG_A,
        vacancyId: 'v1',
        candidateId: 'c1',
        candidateAccountId: 'acct-1',
      });

      const call = prisma.conversation.upsert.mock.calls[0][0];
      expect(call.where).toEqual({
        vacancyId_candidateAccountId: {
          vacancyId: 'v1',
          candidateAccountId: 'acct-1',
        },
      });
      // A second invitation must change nothing on the existing row.
      expect(call.update).toEqual({});
    });
  });

  describe('purgeVacancyConversationsTx — permanent deletion', () => {
    it('hard-deletes messages then conversations of exactly that vacancy', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        { id: 'conv-1' },
        { id: 'conv-2' },
      ]);

      const ids = await service.purgeVacancyConversationsTx(
        prisma as never,
        'v1',
      );

      expect(ids).toEqual(['conv-1', 'conv-2']);
      expect(prisma.conversation.findMany.mock.calls[0][0].where).toEqual({
        vacancyId: 'v1',
      });
      expect(
        prisma.conversationMessage.deleteMany.mock.calls[0][0].where,
      ).toEqual({ conversationId: { in: ['conv-1', 'conv-2'] } });
      expect(prisma.conversation.deleteMany.mock.calls[0][0].where).toEqual({
        id: { in: ['conv-1', 'conv-2'] },
      });
    });

    it('the rejection purge is scoped to ONE candidate on ONE vacancy', async () => {
      prisma.conversation.findMany.mockResolvedValue([{ id: 'conv-A' }]);

      const ids = await service.purgeCandidateVacancyConversationTx(
        prisma as never,
        { vacancyId: 'v1', candidateId: 'cand-A' },
      );

      expect(ids).toEqual(['conv-A']);
      // Candidate B on the same vacancy, and candidate A on another vacancy,
      // are both structurally outside this where clause.
      expect(prisma.conversation.findMany.mock.calls[0][0].where).toEqual({
        vacancyId: 'v1',
        candidateId: 'cand-A',
      });
      expect(
        prisma.conversationMessage.deleteMany.mock.calls[0][0].where,
      ).toEqual({ conversationId: { in: ['conv-A'] } });
      expect(prisma.conversation.deleteMany.mock.calls[0][0].where).toEqual({
        id: { in: ['conv-A'] },
      });
    });

    it('rejecting a never-invited candidate deletes nothing', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);

      const ids = await service.purgeCandidateVacancyConversationTx(
        prisma as never,
        { vacancyId: 'v1', candidateId: 'cand-A' },
      );

      expect(ids).toEqual([]);
      expect(prisma.conversationMessage.deleteMany).not.toHaveBeenCalled();
      expect(prisma.conversation.deleteMany).not.toHaveBeenCalled();
    });

    it('is a no-op for a vacancy without conversations', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);

      const ids = await service.purgeVacancyConversationsTx(
        prisma as never,
        'v1',
      );

      expect(ids).toEqual([]);
      expect(prisma.conversationMessage.deleteMany).not.toHaveBeenCalled();
      expect(prisma.conversation.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('organization side — tenant isolation', () => {
    it('list always constrains to the caller organization', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.conversation.count.mockResolvedValue(0);

      await service.listForOrganization(ORG_A, {
        page: 1,
        limit: 20,
        skip: 0,
      });

      expect(
        prisma.conversation.findMany.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });

    it("404s on another organization's conversation without confirming it exists", async () => {
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.getForOrganization(ORG_B, 'conv-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.conversation.findFirst.mock.calls[0][0].where).toEqual({
        id: 'conv-1',
        organizationId: ORG_B,
      });
    });
  });

  describe('candidate side — ownership isolation', () => {
    it('list is constrained to the CALLER’s candidate account', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: 'acct-1' });
      prisma.conversation.findMany.mockResolvedValue([]);
      prisma.conversation.count.mockResolvedValue(0);

      await service.listForCandidate('user-1', {
        page: 1,
        limit: 20,
        skip: 0,
      });

      expect(prisma.candidateAccount.findUnique.mock.calls[0][0].where).toEqual(
        { userId: 'user-1' },
      );
      expect(
        prisma.conversation.findMany.mock.calls[0][0].where.candidateAccountId,
      ).toBe('acct-1');
    });

    it("candidate A's read of candidate B's conversation is a plain 404", async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: 'acct-A' });
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.getForCandidate('user-A', 'conv-of-B'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.conversation.findFirst.mock.calls[0][0].where).toEqual({
        id: 'conv-of-B',
        candidateAccountId: 'acct-A',
      });
    });

    it('a user without a candidate account cannot use candidate chat', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue(null);

      await expect(
        service.listForCandidate('user-1', {
          page: 1,
          limit: 20,
          skip: 0,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('sending', () => {
    const MESSAGE_ROW = {
      id: 'm1',
      conversationId: 'conv-1',
      senderParty: ConversationParty.CANDIDATE,
      content: 'hello',
      createdAt: new Date(),
      sender: { fullName: 'Ali' },
    };

    it('candidate send authorizes ownership, persists, publishes the realtime event', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: 'acct-1' });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      prisma.conversationMessage.create.mockResolvedValue(MESSAGE_ROW);
      prisma.conversation.update.mockResolvedValue({});

      const view = await service.sendMessageAsCandidate(
        'user-1',
        'conv-1',
        'hello',
      );

      expect(view).toMatchObject({ id: 'm1', senderName: 'Ali' });
      expect(events.publish).toHaveBeenCalledWith(
        'chat.message.created',
        expect.objectContaining({ conversationId: 'conv-1' }),
      );
    });

    it('an unauthorized sender never reaches persistence', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: 'acct-A' });
      prisma.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.sendMessageAsCandidate('user-A', 'conv-of-B', 'hi'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.conversationMessage.create).not.toHaveBeenCalled();
    });

    it('a conversation deleted mid-send surfaces as 404, not a driver error', async () => {
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      prisma.conversationMessage.create.mockRejectedValue({ code: 'P2003' });

      await expect(
        service.sendMessageAsOrganization(ORG_A, 'user-1', 'conv-1', 'hi'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(events.publish).not.toHaveBeenCalled();
    });
  });

  describe('resolveConversationAccess — live socket authorization', () => {
    it('grants CANDIDATE only for a conversation the account owns', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        accountType: AccountType.CANDIDATE,
      });
      prisma.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });

      const party = await service.resolveConversationAccess('user-1', 'conv-1');

      expect(party).toBe(ConversationParty.CANDIDATE);
      expect(prisma.conversation.findFirst.mock.calls[0][0].where).toEqual({
        id: 'conv-1',
        candidateAccount: { userId: 'user-1' },
      });
    });

    it("denies a candidate on someone else's conversation", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        accountType: AccountType.CANDIDATE,
      });
      prisma.conversation.findFirst.mockResolvedValue(null);

      expect(
        await service.resolveConversationAccess('user-1', 'conv-of-B'),
      ).toBeNull();
    });

    it('grants ORGANIZATION only on a LIVE membership in the owning organization', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'hr-1',
        accountType: AccountType.ORGANIZATION,
      });
      prisma.conversation.findUnique.mockResolvedValue({
        organizationId: ORG_A,
      });
      memberships.findMembership.mockResolvedValue({
        id: 'm1',
        user: { accountType: AccountType.ORGANIZATION },
      });

      const party = await service.resolveConversationAccess('hr-1', 'conv-1');

      expect(party).toBe(ConversationParty.ORGANIZATION);
      expect(memberships.findMembership).toHaveBeenCalledWith('hr-1', ORG_A);
    });

    it('denies HR of another organization (no membership row)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'rival-hr',
        accountType: AccountType.ORGANIZATION,
      });
      prisma.conversation.findUnique.mockResolvedValue({
        organizationId: ORG_A,
      });
      memberships.findMembership.mockResolvedValue(null);

      expect(
        await service.resolveConversationAccess('rival-hr', 'conv-1'),
      ).toBeNull();
    });

    it('denies a deleted user outright', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      expect(
        await service.resolveConversationAccess('ghost', 'conv-1'),
      ).toBeNull();
    });
  });
});
