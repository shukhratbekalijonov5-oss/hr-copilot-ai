import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { VacanciesService } from './vacancies.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { VacancyStatus } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
/** The vacancy creator — the only HR user allowed to mutate it. */
const HR_A = 'user-1';
/** A same-organization colleague who did NOT create the vacancy. */
const HR_B = 'user-2';

function createPrismaMock() {
  const mock = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ slug: 'org-a-slug' }),
    },
    vacancy: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    application: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    jobRequirement: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    conversation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  };
  // Support both forms: the array form used by list queries and the callback
  // form used by lifecycle transactions (the callback gets this same mock).
  mock.$transaction.mockImplementation(
    (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof arg === 'function' ? arg(mock) : Promise.all(arg),
  );
  return mock;
}

describe('VacanciesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let producer: { enqueueVacancyIndexSync: jest.Mock };
  let chat: { purgeVacancyConversationsTx: jest.Mock };
  let events: { publish: jest.Mock };
  let service: VacanciesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    producer = { enqueueVacancyIndexSync: jest.fn().mockResolvedValue('j1') };
    chat = { purgeVacancyConversationsTx: jest.fn().mockResolvedValue([]) };
    events = { publish: jest.fn() };
    service = new VacanciesService(
      prisma as unknown as PrismaService,
      new TenantService(),
      producer as never,
      chat as never,
      events as never,
      // The REAL policy over the same prisma mock, so ownership behaviour is
      // exercised, not stubbed.
      new OwnedVacancyService(prisma as unknown as PrismaService),
    );
  });

  describe('create', () => {
    it('stamps the caller organization and creator onto the row', async () => {
      prisma.vacancy.create.mockResolvedValue({ id: 'v1' });

      await service.create(ORG_A, 'user-1', { title: 'Backend Engineer' });

      expect(prisma.vacancy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_A,
            createdById: 'user-1',
            title: 'Backend Engineer',
            status: VacancyStatus.DRAFT,
            // Public identifier minted once at creation: title + org slug +
            // random suffix, never regenerated on later edits.
            publicSlug: expect.stringMatching(
              /^backend-engineer-org-a-slug-[0-9a-f]{6}$/,
            ),
          }),
        }),
      );
    });

    it('retries with a fresh slug on a publicSlug collision', async () => {
      prisma.vacancy.create
        .mockRejectedValueOnce({
          code: 'P2002',
          meta: { target: ['publicSlug'] },
        })
        .mockResolvedValueOnce({ id: 'v1' });

      await service.create(ORG_A, 'user-1', { title: 'Backend Engineer' });

      expect(prisma.vacancy.create).toHaveBeenCalledTimes(2);
      const [first, second] = prisma.vacancy.create.mock.calls;
      expect(first[0].data.publicSlug).not.toBe(second[0].data.publicSlug);
    });
  });

  describe('candidate-visible job index lifecycle', () => {
    it('create queues an index sync', async () => {
      prisma.vacancy.create.mockResolvedValue({ id: 'v1' });

      await service.create(ORG_A, 'user-1', { title: 'Backend Engineer' });

      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledWith({
        vacancyId: 'v1',
      });
    });

    it('update and status changes queue a sync', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: 'DRAFT',
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });

      await service.update(ORG_A, HR_A, 'v1', { title: 'Renamed' });
      await service.setStatus(ORG_A, HR_A, 'v1', VacancyStatus.OPEN);

      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledTimes(2);
    });

    it('deletion queues a sync so the index entry is removed', async () => {
      prisma.vacancy.findMany.mockResolvedValue([
        { id: 'v1', title: 't', createdById: HR_A, applications: [] },
      ]);
      prisma.vacancy.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove(ORG_A, HR_A, 'v1');

      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledWith({
        vacancyId: 'v1',
      });
    });

    it('requirement edits queue a sync (candidate-visible content changed)', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: 'OPEN',
        createdById: HR_A,
      });
      prisma.jobRequirement.create.mockResolvedValue({ id: 'r1' });

      await service.addRequirement(ORG_A, HR_A, 'v1', { text: 'Docker' });

      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledWith({
        vacancyId: 'v1',
      });
    });

    it('a queue outage never fails recruiter CRUD', async () => {
      producer.enqueueVacancyIndexSync.mockRejectedValue(
        new Error('redis down'),
      );
      prisma.vacancy.create.mockResolvedValue({ id: 'v1' });

      await expect(
        service.create(ORG_A, 'user-1', { title: 'Backend Engineer' }),
      ).resolves.toMatchObject({ id: 'v1' });
    });
  });

  describe('findAll — tenant isolation', () => {
    beforeEach(() => {
      prisma.vacancy.findMany.mockResolvedValue([]);
      prisma.vacancy.count.mockResolvedValue(0);
    });

    it('always constrains the query to the caller organization', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      const where = prisma.vacancy.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
    });

    it('keeps the tenant filter even when search filters are supplied', async () => {
      await service.findAll(ORG_A, {
        page: 1,
        limit: 20,
        skip: 0,
        search: 'engineer',
        status: VacancyStatus.OPEN,
      });

      const where = prisma.vacancy.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      expect(where.status).toBe(VacancyStatus.OPEN);
    });

    it('returns pagination metadata', async () => {
      prisma.vacancy.count.mockResolvedValue(45);
      const result = await service.findAll(ORG_A, {
        page: 2,
        limit: 20,
        skip: 20,
      });

      expect(result.meta).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
      });
    });
  });

  describe('findOne — tenant isolation', () => {
    it('scopes the lookup by organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        organizationId: ORG_A,
      });

      await service.findOne(ORG_A, 'v1');

      expect(prisma.vacancy.findFirst.mock.calls[0][0].where).toEqual({
        id: 'v1',
        organizationId: ORG_A,
      });
    });

    it("404s on another organization's vacancy rather than leaking its existence", async () => {
      // The org-scoped query simply finds nothing.
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_B, 'v1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update / delete — tenant isolation', () => {
    it('refuses to update a vacancy from another organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ORG_B, HR_A, 'v1', { title: 'Hijacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.vacancy.update).not.toHaveBeenCalled();
    });

    it('refuses to delete a vacancy from another organization', async () => {
      prisma.vacancy.findMany.mockResolvedValue([]);

      await expect(service.remove(ORG_B, HR_A, 'v1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.vacancy.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('creator ownership — same-org colleagues cannot mutate', () => {
    const OWNED_BY_A = {
      id: 'v1',
      title: 'Backend Engineer',
      status: VacancyStatus.OPEN,
      createdById: HR_A,
    };

    it('403 VACANCY_NOT_OWNED when a colleague edits it', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(OWNED_BY_A);

      try {
        await service.update(ORG_A, HR_B, 'v1', { title: 'Hijacked' });
        fail('expected the update to be refused');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toMatchObject({
          code: 'VACANCY_NOT_OWNED',
        });
      }
      expect(prisma.vacancy.update).not.toHaveBeenCalled();
    });

    it('a colleague cannot close it', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(OWNED_BY_A);

      await expect(
        service.setStatus(ORG_A, HR_B, 'v1', VacancyStatus.CLOSED),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(chat.purgeVacancyConversationsTx).not.toHaveBeenCalled();
    });

    it('a colleague cannot delete it', async () => {
      prisma.vacancy.findMany.mockResolvedValue([
        { id: 'v1', title: 't', createdById: HR_A, applications: [] },
      ]);

      await expect(service.remove(ORG_A, HR_B, 'v1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.vacancy.deleteMany).not.toHaveBeenCalled();
    });

    it('a colleague cannot edit its requirements', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(OWNED_BY_A);

      await expect(
        service.addRequirement(ORG_A, HR_B, 'v1', { text: 'Injected' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.jobRequirement.create).not.toHaveBeenCalled();
    });
  });

  describe('findMine — the My Vacancies selector', () => {
    beforeEach(() => {
      prisma.vacancy.findMany.mockResolvedValue([]);
      prisma.vacancy.count.mockResolvedValue(0);
    });

    it('constrains to the caller organization AND the caller as creator', async () => {
      await service.findMine(ORG_A, HR_A, { page: 1, limit: 20, skip: 0 });

      const where = prisma.vacancy.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      expect(where.createdById).toBe(HR_A);
    });

    it('returns slim selector rows, never full vacancy objects', async () => {
      prisma.vacancy.findMany.mockResolvedValue([
        {
          id: 'v1',
          title: 'Backend Engineer',
          status: VacancyStatus.OPEN,
          createdAt: new Date('2026-01-01'),
          _count: { applications: 4, requirements: 6 },
        },
      ]);
      prisma.vacancy.count.mockResolvedValue(1);

      const result = await service.findMine(ORG_A, HR_A, {
        page: 1,
        limit: 20,
        skip: 0,
      });

      expect(result.data[0]).toEqual({
        id: 'v1',
        title: 'Backend Engineer',
        status: VacancyStatus.OPEN,
        createdAt: new Date('2026-01-01'),
        candidateCount: 4,
        requirementCount: 6,
      });
      // No description/publicSlug/creator internals in selector rows.
      expect(result.data[0]).not.toHaveProperty('description');
    });
  });

  describe('listVacancyCandidates — APPLICANTS only', () => {
    beforeEach(() => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 'Backend',
        status: 'OPEN',
        createdById: HR_A,
      });
    });

    it('asks only for real applications by account-backed candidates', async () => {
      await service.listVacancyCandidates(ORG_A, HR_A, 'v1', {
        page: 1,
        limit: 20,
        skip: 0,
      });

      const args = prisma.application.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        vacancyId: 'v1',
        source: 'DIRECT',
        candidate: {
          organizationId: ORG_A,
          candidateAccountId: { not: null },
        },
      });
      // Every row is an applicant, so no source/account labelling is
      // selected — the "manual vs platform" distinction no longer exists.
      expect(args.select.source).toBeUndefined();
      expect(args.select.candidate.select.candidateAccountId).toBeUndefined();
    });

    it('keeps the applicant filter alongside a name search', async () => {
      await service.listVacancyCandidates(ORG_A, HR_A, 'v1', {
        page: 1,
        limit: 20,
        skip: 0,
        search: 'kim',
      });

      const where = prisma.application.findMany.mock.calls[0][0].where;
      expect(where.candidate.candidateAccountId).toEqual({ not: null });
      expect(where.candidate.OR).toHaveLength(2);
    });
  });

  describe('bulkRemove — all-or-nothing owned batch', () => {
    it('captures deletion recipients from APPLICATIONS only', async () => {
      prisma.vacancy.findMany.mockResolvedValue([
        { id: 'v1', title: 'Backend', createdById: HR_A, applications: [] },
      ]);
      prisma.vacancy.deleteMany.mockResolvedValue({ count: 1 });

      await service.bulkRemove(ORG_A, HR_A, ['v1']);

      const select = prisma.vacancy.findMany.mock.calls[0][0].select;
      expect(select.applications.where).toMatchObject({
        source: 'DIRECT',
        candidate: { candidateAccountId: { not: null } },
      });
    });

    it('deletes an owned selection and purges each vacancy chats in-tx', async () => {
      prisma.vacancy.findMany.mockResolvedValue([
        { id: 'v1', title: 'Backend', createdById: HR_A, applications: [] },
        { id: 'v2', title: 'Data', createdById: HR_A, applications: [] },
      ]);
      prisma.vacancy.deleteMany.mockResolvedValue({ count: 2 });
      chat.purgeVacancyConversationsTx
        .mockResolvedValueOnce(['conv-1'])
        .mockResolvedValueOnce([]);

      const result = await service.bulkRemove(ORG_A, HR_A, ['v1', 'v2']);

      expect(result).toEqual({ deletedIds: ['v1', 'v2'], deletedCount: 2 });
      // Purge ran through the established chat lifecycle helper, in-tx.
      expect(chat.purgeVacancyConversationsTx).toHaveBeenCalledWith(
        prisma,
        'v1',
      );
      expect(chat.purgeVacancyConversationsTx).toHaveBeenCalledWith(
        prisma,
        'v2',
      );
      expect(prisma.vacancy.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['v1', 'v2'] } },
      });
      expect(events.publish).toHaveBeenCalledWith(
        'chat.conversations.deleted',
        expect.objectContaining({
          vacancyId: 'v1',
          conversationIds: ['conv-1'],
        }),
      );
      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledTimes(2);
    });

    it('a batch containing a colleague vacancy deletes NOTHING', async () => {
      prisma.vacancy.findMany.mockResolvedValue([
        { id: 'v1', title: 't', createdById: HR_A, applications: [] },
        { id: 'v2', title: 't', createdById: HR_B, applications: [] }, // the colleague's
      ]);

      await expect(
        service.bulkRemove(ORG_A, HR_A, ['v1', 'v2']),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.vacancy.deleteMany).not.toHaveBeenCalled();
      expect(chat.purgeVacancyConversationsTx).not.toHaveBeenCalled();
    });

    it('a batch containing a foreign/unknown id is 404 and deletes NOTHING', async () => {
      prisma.vacancy.findMany.mockResolvedValue([
        { id: 'v1', title: 't', createdById: HR_A, applications: [] },
      ]);

      await expect(
        service.bulkRemove(ORG_A, HR_A, ['v1', 'v-foreign']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.vacancy.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('setStatus', () => {
    it('closes an open vacancy', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.OPEN,
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });

      await service.setStatus(ORG_A, HR_A, 'v1', VacancyStatus.CLOSED);

      expect(prisma.vacancy.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { status: VacancyStatus.CLOSED },
      });
    });

    it('purges every conversation INSIDE the close transaction', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.OPEN,
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });
      chat.purgeVacancyConversationsTx.mockResolvedValue(['conv-1', 'conv-2']);

      await service.setStatus(ORG_A, HR_A, 'v1', VacancyStatus.CLOSED);

      // The purge received the SAME transaction client as the status update.
      expect(chat.purgeVacancyConversationsTx).toHaveBeenCalledWith(
        prisma,
        'v1',
      );
      expect(events.publish).toHaveBeenCalledWith(
        'chat.conversations.deleted',
        expect.objectContaining({
          vacancyId: 'v1',
          reason: 'VACANCY_CLOSED',
          conversationIds: ['conv-1', 'conv-2'],
        }),
      );
      expect(events.publish).toHaveBeenCalledWith(
        'vacancy.closed',
        expect.objectContaining({
          organizationId: ORG_A,
          vacancyId: 'v1',
          deletedConversationIds: ['conv-1', 'conv-2'],
        }),
      );
    });

    it('archiving purges conversations too (direct OPEN→ARCHIVED must not bypass)', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.OPEN,
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });
      chat.purgeVacancyConversationsTx.mockResolvedValue(['conv-1']);

      await service.setStatus(ORG_A, HR_A, 'v1', VacancyStatus.ARCHIVED);

      expect(chat.purgeVacancyConversationsTx).toHaveBeenCalledWith(
        prisma,
        'v1',
      );
      // Archive is not a close for the (future) notification system.
      expect(events.publish).not.toHaveBeenCalledWith(
        'vacancy.closed',
        expect.anything(),
      );
    });

    it('a failed purge aborts the whole close (never CLOSED-with-chats)', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.OPEN,
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });
      chat.purgeVacancyConversationsTx.mockRejectedValue(
        new Error('purge failed'),
      );

      await expect(
        service.setStatus(ORG_A, HR_A, 'v1', VacancyStatus.CLOSED),
      ).rejects.toThrow('purge failed');
      // The rejection propagated out of $transaction — with a real database
      // the status update rolls back with it.
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('opening a vacancy purges nothing', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.DRAFT,
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });

      await service.setStatus(ORG_A, HR_A, 'v1', VacancyStatus.OPEN);

      expect(chat.purgeVacancyConversationsTx).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('refuses to move an archived vacancy back into another state', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.ARCHIVED,
        createdById: HR_A,
      });

      await expect(
        service.setStatus(ORG_A, HR_A, 'v1', VacancyStatus.OPEN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.vacancy.update).not.toHaveBeenCalled();
    });
  });

  describe('update — the PATCH route cannot bypass the close invariant', () => {
    it('a plain PATCH that sets status CLOSED purges conversations', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.OPEN,
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });
      chat.purgeVacancyConversationsTx.mockResolvedValue(['conv-1']);

      await service.update(ORG_A, HR_A, 'v1', { status: VacancyStatus.CLOSED });

      expect(chat.purgeVacancyConversationsTx).toHaveBeenCalledWith(
        prisma,
        'v1',
      );
      expect(events.publish).toHaveBeenCalledWith(
        'vacancy.closed',
        expect.objectContaining({ vacancyId: 'v1' }),
      );
    });

    it('a PATCH without a status change purges nothing', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.OPEN,
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });

      await service.update(ORG_A, HR_A, 'v1', { title: 'Renamed' });

      expect(chat.purgeVacancyConversationsTx).not.toHaveBeenCalled();
    });

    it('re-PATCHing an already CLOSED vacancy does not re-publish vacancy.closed', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.CLOSED,
        createdById: HR_A,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });

      await service.update(ORG_A, HR_A, 'v1', { status: VacancyStatus.CLOSED });

      // Idempotent purge still runs (deletes nothing), but no duplicate event.
      expect(events.publish).not.toHaveBeenCalledWith(
        'vacancy.closed',
        expect.anything(),
      );
    });
  });

  describe('job requirements — tenancy inherited from the vacancy', () => {
    it('rejects adding a requirement to another organization vacancy', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(
        service.addRequirement(ORG_B, HR_A, 'v1', {
          text: 'Injected requirement',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.jobRequirement.create).not.toHaveBeenCalled();
    });

    it('filters requirement updates through the parent vacancy organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: VacancyStatus.OPEN,
        createdById: HR_A,
      });
      prisma.jobRequirement.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.jobRequirement.update.mockResolvedValue({ id: 'r1' });

      await service.updateRequirement(ORG_A, HR_A, 'v1', 'r1', {
        required: false,
      });

      expect(prisma.jobRequirement.findFirst.mock.calls[0][0].where).toEqual({
        id: 'r1',
        vacancyId: 'v1',
        vacancy: { organizationId: ORG_A },
      });
    });
  });
});
