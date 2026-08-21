import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import {
  ApplicationSource,
  ApplicationStatus,
  VacancyStatus,
} from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
/** The vacancy creator. */
const HR_A = 'user-a';
/** A same-org colleague who did NOT create the vacancy. */
const HR_B = 'user-b';

function createPrismaMock() {
  const mock = {
    application: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    vacancy: { findFirst: jest.fn() },
    candidate: { findFirst: jest.fn() },
    // Link snapshots cascade with their application; their ids are read
    // before the delete so their vectors can still be evicted afterwards.
    applicationLinkSource: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  // Array form for list queries, callback form for the invitation transaction.
  mock.$transaction.mockImplementation(
    (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof arg === 'function' ? arg(mock) : Promise.all(arg),
  );
  return mock;
}

describe('ApplicationsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let chat: {
    createForInvitationTx: jest.Mock;
    purgeCandidateVacancyConversationTx: jest.Mock;
  };
  let events: { publish: jest.Mock };
  let producer: { enqueueApplicationLinkIndexDeletion: jest.Mock };
  let service: ApplicationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    producer = {
      enqueueApplicationLinkIndexDeletion: jest.fn().mockResolvedValue('job-1'),
    };
    chat = {
      createForInvitationTx: jest.fn(),
      purgeCandidateVacancyConversationTx: jest.fn().mockResolvedValue([]),
    };
    events = { publish: jest.fn() };
    service = new ApplicationsService(
      prisma as unknown as PrismaService,
      new TenantService(),
      chat as never,
      events as never,
      // The REAL ownership policy over the same prisma mock.
      new OwnedVacancyService(prisma as unknown as PrismaService),
      producer as never,
    );
    // Default: vacancy v1 exists in the caller org and was created by HR_A.
    prisma.vacancy.findFirst.mockResolvedValue({
      id: 'v1',
      title: 'Backend Engineer',
      status: 'OPEN',
      createdById: HR_A,
    });
  });

  it('exposes no way to create or associate an application', () => {
    // Recruiter-made associations were removed: an Application row is written
    // by the candidate applying, and by nothing else.
    expect(
      (service as unknown as Record<string, unknown>).create,
    ).toBeUndefined();
  });

  describe('findAll — tenancy through both relations', () => {
    it('filters on the vacancy and the candidate organization', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);

      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      const where = prisma.application.findMany.mock.calls[0][0].where;
      expect(where.vacancy).toEqual({ organizationId: ORG_A });
      expect(where.candidate).toEqual({
        organizationId: ORG_A,
        candidateAccountId: { not: null },
      });
      // Applicants only: a historical recruiter-made row is not listed.
      expect(where.source).toBe(ApplicationSource.DIRECT);
    });
  });

  describe('updateStatus — human-controlled stage changes', () => {
    const row = {
      id: 'a1',
      vacancyId: 'v1',
      candidate: { id: 'c1', candidateAccountId: 'acct-1' },
    };

    it('applies the requested status', async () => {
      prisma.application.findFirst.mockResolvedValue(row);
      prisma.application.update.mockResolvedValue({ id: 'a1' });

      await service.updateStatus(ORG_A, HR_A, 'a1', ApplicationStatus.OFFER);

      expect(prisma.application.update.mock.calls[0][0].data).toEqual({
        status: ApplicationStatus.OFFER,
      });
    });

    it('allows a human to reverse a decision', async () => {
      prisma.application.findFirst.mockResolvedValue(row);
      prisma.application.update.mockResolvedValue({ id: 'a1' });

      await service.updateStatus(
        ORG_A,
        HR_A,
        'a1',
        ApplicationStatus.REVIEWING,
      );

      expect(prisma.application.update).toHaveBeenCalled();
    });

    it('refuses to change an application in another organization', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStatus(ORG_B, HR_A, 'a1', ApplicationStatus.HIRED),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('INTERVIEW routes through the full invitation (conversation unlocked)', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: 'a1',
        vacancy: { id: 'v1', status: VacancyStatus.OPEN },
        candidate: { id: 'c1', candidateAccountId: 'acct-1' },
      });
      prisma.application.update.mockResolvedValue({ id: 'a1' });
      chat.createForInvitationTx.mockResolvedValue({ id: 'conv-1' });

      await service.updateStatus(
        ORG_A,
        HR_A,
        'a1',
        ApplicationStatus.INTERVIEW,
      );

      expect(chat.createForInvitationTx).toHaveBeenCalledWith(prisma, {
        organizationId: ORG_A,
        vacancyId: 'v1',
        candidateId: 'c1',
        candidateAccountId: 'acct-1',
      });
    });

    it('REJECTED publishes the domain event and creates no conversation', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: 'a1',
        vacancyId: 'v1',
        candidate: { id: 'c1', candidateAccountId: 'acct-1' },
      });
      prisma.application.update.mockResolvedValue({ id: 'a1' });

      await service.updateStatus(ORG_A, HR_A, 'a1', ApplicationStatus.REJECTED);

      expect(chat.createForInvitationTx).not.toHaveBeenCalled();
      expect(events.publish).toHaveBeenCalledWith(
        'application.rejected',
        expect.objectContaining({
          organizationId: ORG_A,
          applicationId: 'a1',
          candidateId: 'c1',
        }),
      );
    });

    it('REJECTED purges that candidate’s conversation INSIDE the transaction', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: 'a1',
        vacancyId: 'v1',
        candidate: { id: 'c1', candidateAccountId: 'acct-1' },
      });
      prisma.application.update.mockResolvedValue({ id: 'a1' });
      chat.purgeCandidateVacancyConversationTx.mockResolvedValue(['conv-1']);

      await service.updateStatus(ORG_A, HR_A, 'a1', ApplicationStatus.REJECTED);

      // Scoped to exactly this candidate on exactly this vacancy, and handed
      // the SAME transaction client as the status update.
      expect(chat.purgeCandidateVacancyConversationTx).toHaveBeenCalledWith(
        prisma,
        { vacancyId: 'v1', candidateId: 'c1' },
      );
      expect(events.publish).toHaveBeenCalledWith(
        'chat.conversations.deleted',
        {
          vacancyId: 'v1',
          reason: 'CANDIDATE_REJECTED',
          vacancyStatus: null,
          conversationIds: ['conv-1'],
        },
      );
      expect(events.publish).toHaveBeenCalledWith(
        'application.rejected',
        expect.objectContaining({ deletedConversationId: 'conv-1' }),
      );
    });

    it('rejecting before any interview deletes nothing and emits no chat event', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: 'a1',
        vacancyId: 'v1',
        candidate: { id: 'c1', candidateAccountId: 'acct-1' },
      });
      prisma.application.update.mockResolvedValue({ id: 'a1' });
      chat.purgeCandidateVacancyConversationTx.mockResolvedValue([]);

      await service.updateStatus(ORG_A, HR_A, 'a1', ApplicationStatus.REJECTED);

      expect(events.publish).not.toHaveBeenCalledWith(
        'chat.conversations.deleted',
        expect.anything(),
      );
      expect(events.publish).toHaveBeenCalledWith(
        'application.rejected',
        expect.objectContaining({ deletedConversationId: null }),
      );
    });

    it('a failed purge aborts the rejection (never REJECTED with a live chat)', async () => {
      prisma.application.findFirst.mockResolvedValue({
        id: 'a1',
        vacancyId: 'v1',
        candidate: { id: 'c1', candidateAccountId: 'acct-1' },
      });
      prisma.application.update.mockResolvedValue({ id: 'a1' });
      chat.purgeCandidateVacancyConversationTx.mockRejectedValue(
        new Error('purge failed'),
      );

      await expect(
        service.updateStatus(ORG_A, HR_A, 'a1', ApplicationStatus.REJECTED),
      ).rejects.toThrow('purge failed');
      // The rejection propagated out of $transaction — with a real database
      // the status update rolls back with it, and nothing was announced.
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('a non-rejecting status never purges chat', async () => {
      prisma.application.findFirst.mockResolvedValue(row);
      prisma.application.update.mockResolvedValue({ id: 'a1' });

      await service.updateStatus(ORG_A, HR_A, 'a1', ApplicationStatus.OFFER);

      expect(chat.purgeCandidateVacancyConversationTx).not.toHaveBeenCalled();
    });
  });

  describe('inviteToInterview — THE conversation-creating transition', () => {
    const appRow = (
      accountId: string,
      status: VacancyStatus = VacancyStatus.OPEN,
    ) => ({
      id: 'a1',
      vacancy: { id: 'v1', status },
      candidate: { id: 'c1', candidateAccountId: accountId },
    });

    it('transitions to INTERVIEW and unlocks the conversation in ONE transaction', async () => {
      prisma.application.findFirst.mockResolvedValue(appRow('acct-1'));
      prisma.application.update.mockResolvedValue({ id: 'a1' });
      chat.createForInvitationTx.mockResolvedValue({
        id: 'conv-1',
        vacancyId: 'v1',
        createdAt: new Date(),
      });

      const result = await service.inviteToInterview(ORG_A, HR_A, 'a1');

      expect(prisma.application.update.mock.calls[0][0].data).toEqual({
        status: ApplicationStatus.INTERVIEW,
      });
      expect(result.conversation).toMatchObject({ id: 'conv-1' });
      expect(events.publish).toHaveBeenCalledWith(
        'interview.invited',
        expect.objectContaining({
          conversationId: 'conv-1',
          candidateAccountId: 'acct-1',
        }),
      );
    });

    it('reads the application under the applicant scope, never tenancy alone', async () => {
      // A historical recruiter-made association simply is not found here, so
      // the accountless-candidate branch cannot be reached at all.
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.inviteToInterview(ORG_A, HR_A, 'a-manual'),
      ).rejects.toBeInstanceOf(NotFoundException);

      const where = prisma.application.findFirst.mock.calls[0][0].where;
      expect(where.source).toBe(ApplicationSource.DIRECT);
      expect(where.candidate).toMatchObject({
        candidateAccountId: { not: null },
      });
      expect(chat.createForInvitationTx).not.toHaveBeenCalled();
    });

    it('refuses to invite on a CLOSED vacancy (would bypass close-deletes-chats)', async () => {
      prisma.application.findFirst.mockResolvedValue(
        appRow('acct-1', VacancyStatus.CLOSED),
      );

      await expect(
        service.inviteToInterview(ORG_A, HR_A, 'a1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.application.update).not.toHaveBeenCalled();
      expect(chat.createForInvitationTx).not.toHaveBeenCalled();
    });

    it("404s on another organization's application", async () => {
      prisma.application.findFirst.mockResolvedValue(null);
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(
        service.inviteToInterview(ORG_B, HR_A, 'a1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("a same-org colleague cannot invite on HR A's vacancy", async () => {
      prisma.application.findFirst.mockResolvedValue(appRow('acct-1'));

      await expect(
        service.inviteToInterview(ORG_A, HR_B, 'a1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.application.update).not.toHaveBeenCalled();
      expect(chat.createForInvitationTx).not.toHaveBeenCalled();
    });
  });

  describe('remove — deleting the application takes its chat with it', () => {
    const deletable = { id: 'a1', vacancyId: 'v1', candidateId: 'c1' };

    it('purges the exact vacancy/candidate conversation INSIDE the transaction', async () => {
      prisma.application.findFirst.mockResolvedValue(deletable);
      prisma.application.delete.mockResolvedValue({ id: 'a1' });
      chat.purgeCandidateVacancyConversationTx.mockResolvedValue(['conv-1']);

      const result = await service.remove(ORG_A, HR_A, 'a1');

      // Scoped to this pair only, on the same transaction client that deletes.
      expect(chat.purgeCandidateVacancyConversationTx).toHaveBeenCalledWith(
        prisma,
        { vacancyId: 'v1', candidateId: 'c1' },
      );
      expect(prisma.application.delete).toHaveBeenCalledWith({
        where: { id: 'a1' },
      });
      expect(events.publish).toHaveBeenCalledWith(
        'chat.conversations.deleted',
        {
          vacancyId: 'v1',
          reason: 'APPLICATION_DELETED',
          vacancyStatus: null,
          conversationIds: ['conv-1'],
        },
      );
      expect(result).toEqual({ id: 'a1', deleted: true });
    });

    it('deleting an application that never reached interview succeeds silently', async () => {
      prisma.application.findFirst.mockResolvedValue(deletable);
      prisma.application.delete.mockResolvedValue({ id: 'a1' });
      chat.purgeCandidateVacancyConversationTx.mockResolvedValue([]);

      const result = await service.remove(ORG_A, HR_A, 'a1');

      expect(result).toEqual({ id: 'a1', deleted: true });
      // No conversation existed — nothing to announce.
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('a failed purge rolls the deletion back and announces nothing', async () => {
      prisma.application.findFirst.mockResolvedValue(deletable);
      chat.purgeCandidateVacancyConversationTx.mockRejectedValue(
        new Error('purge failed'),
      );

      await expect(service.remove(ORG_A, HR_A, 'a1')).rejects.toThrow(
        'purge failed',
      );
      // The purge runs first, so the delete never issued; with a real database
      // the surrounding transaction rolls back regardless.
      expect(prisma.application.delete).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it("404s on another organization's application without deleting anything", async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG_B, HR_A, 'a1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(chat.purgeCandidateVacancyConversationTx).not.toHaveBeenCalled();
      expect(prisma.application.delete).not.toHaveBeenCalled();
    });
  });
});
