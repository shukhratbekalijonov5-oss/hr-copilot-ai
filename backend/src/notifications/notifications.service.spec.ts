import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import {
  NotificationAudience,
  NotificationType,
} from '../generated/prisma/enums';

const ME = 'user-me';
const OTHER = 'user-other';
const ORG = 'org-a';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  audience: 'HR',
  type: 'NEW_MESSAGE',
  recipientUserId: ME,
  organizationId: ORG,
  vacancyId: 'v1',
  candidateId: 'c1',
  applicationId: null,
  conversationId: 'conv-1',
  messageId: 'm1',
  actorUserId: OTHER,
  vacancyTitleSnapshot: 'Backend Engineer',
  candidateNameSnapshot: 'John Kim',
  actorNameSnapshot: 'John Kim',
  messagePreview: 'Hello',
  metadata: null,
  isRead: false,
  readAt: null,
  createdAt: new Date('2026-08-21T10:00:00Z'),
  ...over,
});

function createPrismaMock() {
  const mock = {
    notification: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(row(data)),
      ),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return mock;
}

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let events: { publish: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    events = { publish: jest.fn() };
    service = new NotificationsService(
      prisma as never,
      events as unknown as DomainEventsService,
    );
  });

  describe('create', () => {
    it('persists FIRST, then publishes the realtime signal with the API view', async () => {
      const view = await service.create({
        audience: NotificationAudience.HR,
        type: NotificationType.NEW_MESSAGE,
        recipientUserId: ME,
        organizationId: ORG,
        vacancyId: 'v1',
        vacancyTitleSnapshot: 'Backend Engineer',
      });

      expect(prisma.notification.create).toHaveBeenCalled();
      expect(events.publish).toHaveBeenCalledWith('notification.created', {
        recipientUserId: ME,
        notification: view,
      });
      // Structured view, not a rendered sentence.
      expect(view.vacancy).toEqual({
        id: 'v1',
        title: 'Backend Engineer',
        deleted: false,
      });
    });

    it('marks the vacancy as deleted on VACANCY_DELETED views', async () => {
      const view = await service.create({
        audience: NotificationAudience.CANDIDATE,
        type: NotificationType.VACANCY_DELETED,
        recipientUserId: ME,
        vacancyId: 'v-gone',
        vacancyTitleSnapshot: 'Backend Engineer',
      });
      expect(view.vacancy).toEqual({
        id: 'v-gone',
        title: 'Backend Engineer',
        deleted: true,
      });
    });
  });

  describe('recipient scoping — the cross-user wall', () => {
    it('list is anchored on the caller and their active organization', async () => {
      await service.list(ME, ORG, { page: 1, limit: 20, skip: 0 });

      const where = prisma.notification.findMany.mock.calls[0][0].where;
      expect(where.recipientUserId).toBe(ME);
      expect(where.OR).toEqual([
        { organizationId: null },
        { organizationId: ORG },
      ]);
    });

    it('a candidate (no org) sees only organization-less rows', async () => {
      await service.list(ME, null, { page: 1, limit: 20, skip: 0 });

      const where = prisma.notification.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ organizationId: null }]);
    });

    it("markRead on someone else's id is an undisclosing 404", async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.markRead(ME, ORG, 'n-foreign'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.notification.update).not.toHaveBeenCalled();
      // The lookup itself was recipient-constrained.
      expect(
        prisma.notification.findFirst.mock.calls[0][0].where,
      ).toMatchObject({ recipientUserId: ME });
    });

    it('markAllRead touches only the caller unread rows', async () => {
      await service.markAllRead(ME, ORG);

      const call = prisma.notification.updateMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ recipientUserId: ME, isRead: false });
      expect(call.data).toMatchObject({ isRead: true });
      expect(call.data.readAt).toBeInstanceOf(Date);
    });
  });

  describe('read state', () => {
    it('marks unread → read with a timestamp', async () => {
      prisma.notification.findFirst.mockResolvedValue(row());
      prisma.notification.update.mockResolvedValue(
        row({ isRead: true, readAt: new Date() }),
      );

      const view = await service.markRead(ME, ORG, 'n1');

      expect(view.isRead).toBe(true);
      expect(prisma.notification.update.mock.calls[0][0].data.isRead).toBe(
        true,
      );
    });

    it('marking an already-read row is idempotent (no second write)', async () => {
      prisma.notification.findFirst.mockResolvedValue(
        row({ isRead: true, readAt: new Date() }),
      );

      await service.markRead(ME, ORG, 'n1');

      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('unreadCount counts only unread rows in scope', async () => {
      prisma.notification.count.mockResolvedValue(4);
      const result = await service.unreadCount(ME, ORG);
      expect(result).toEqual({ unread: 4 });
      expect(prisma.notification.count.mock.calls[0][0].where.isRead).toBe(
        false,
      );
    });
  });
});
