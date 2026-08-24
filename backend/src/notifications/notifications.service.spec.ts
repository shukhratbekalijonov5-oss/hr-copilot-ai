import { NotFoundException } from '@nestjs/common';
import { NotificationsService, toView } from './notifications.service';
import type {
  JavaNotificationRow,
  NotificationServiceClient,
} from './notification-service.client';

/**
 * The BFF layer over the Java notification authority: caller-scoped
 * delegation, byte-compatible view mapping, and honest error passthrough
 * (404 stays 404; outages stay coded 503s from the client). The recipient
 * wall itself is enforced by the Java side and covered by e2e.
 */

const ROW: JavaNotificationRow = {
  id: 'n1',
  type: 'NEW_MESSAGE',
  audience: 'HR',
  organizationId: 'org-a',
  isRead: false,
  readAt: null,
  createdAt: '2026-08-25T10:00:00Z',
  vacancyId: 'v1',
  vacancyTitle: 'Backend Engineer',
  candidateId: 'c1',
  candidateName: 'John Kim',
  actorName: 'John Kim',
  applicationId: null,
  conversationId: 'conv-1',
  messageId: 'm1',
  messagePreview: 'Hello',
};

function clientFake(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    list: jest.fn().mockResolvedValue({ data: [ROW], total: 1 }),
    unreadCount: jest.fn().mockResolvedValue(3),
    markRead: jest.fn().mockResolvedValue({
      ...ROW,
      isRead: true,
      readAt: '2026-08-25T11:00:00Z',
    }),
    markAllRead: jest.fn().mockResolvedValue({ updated: 2 }),
    ...overrides,
  } as unknown as NotificationServiceClient & Record<string, jest.Mock>;
}

describe('list', () => {
  it('forwards the CALLER identity + workspace and answers the paginated view contract', async () => {
    const client = clientFake();
    const service = new NotificationsService(client);

    const result = await service.list('me', 'org-a', {
      page: 2,
      limit: 10,
      skip: 10,
      unreadOnly: true,
    });

    expect(client.list).toHaveBeenCalledWith({
      userId: 'me',
      organizationId: 'org-a',
      page: 2,
      limit: 10,
      unreadOnly: true,
      type: undefined,
    });
    expect(result.meta).toEqual({
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
    });
    expect(result.data[0]).toEqual({
      id: 'n1',
      type: 'NEW_MESSAGE',
      audience: 'HR',
      isRead: false,
      readAt: null,
      createdAt: '2026-08-25T10:00:00Z',
      vacancy: { id: 'v1', title: 'Backend Engineer', deleted: false },
      candidate: { id: 'c1', name: 'John Kim' },
      actor: { name: 'John Kim' },
      applicationId: null,
      conversationId: 'conv-1',
      messageId: 'm1',
      messagePreview: 'Hello',
    });
  });
});

describe('toView', () => {
  it('marks the vacancy deleted for VACANCY_DELETED and drops half-empty relations', () => {
    const view = toView({
      ...ROW,
      type: 'VACANCY_DELETED',
      candidateName: null,
      actorName: null,
    });
    expect(view.vacancy).toEqual({
      id: 'v1',
      title: 'Backend Engineer',
      deleted: true,
    });
    expect(view.candidate).toBeNull();
    expect(view.actor).toBeNull();
  });
});

describe('marks and counts', () => {
  it('unread count and mark-all delegate with the caller identity', async () => {
    const client = clientFake();
    const service = new NotificationsService(client);
    expect(await service.unreadCount('me', null)).toEqual({ unread: 3 });
    expect(await service.markAllRead('me', 'org-a')).toEqual({ updated: 2 });
    expect(client.unreadCount).toHaveBeenCalledWith('me', null);
    expect(client.markAllRead).toHaveBeenCalledWith('me', 'org-a');
  });

  it("someone else's id stays a 404 — the upstream wall's answer passes through", async () => {
    const client = clientFake({
      markRead: jest.fn().mockRejectedValue(new NotFoundException()),
    });
    const service = new NotificationsService(client);
    await expect(
      service.markRead('me', null, 'not-mine'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
