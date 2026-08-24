import { Injectable } from '@nestjs/common';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import type {
  NotificationAudience,
  NotificationType,
} from '../generated/prisma/enums';
import type { NotificationView } from './notification-view';
import type { QueryNotificationsDto } from './dto/query-notifications.dto';
import {
  NotificationServiceClient,
  type JavaNotificationRow,
} from './notification-service.client';

/**
 * The notification BFF — the browser contract, unchanged, now served from
 * the Java Notification Service, which owns the rows and the read/unread
 * state. Nothing here persists notifications anymore: creation happens
 * through the outbox → Kafka → Java pipeline, and this class only READS and
 * MARKS on behalf of the authenticated caller.
 *
 * The recipient wall is enforced twice: this side only ever forwards the
 * authenticated caller's userId (plus their active workspace for HR-row
 * presentation scoping), and the Java side anchors every query on that
 * userId — a cross-user id is a 404 there and stays a 404 here.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly client: NotificationServiceClient) {}

  async list(
    userId: string,
    activeOrganizationId: string | null,
    query: QueryNotificationsDto,
  ): Promise<PaginatedResult<NotificationView>> {
    const result = await this.client.list({
      userId,
      organizationId: activeOrganizationId,
      page: query.page,
      limit: query.limit,
      unreadOnly: query.unreadOnly,
      type: query.type,
    });
    return paginated(
      result.data.map(toView),
      result.total,
      query.page,
      query.limit,
    );
  }

  async unreadCount(
    userId: string,
    activeOrganizationId: string | null,
  ): Promise<{ unread: number }> {
    return {
      unread: await this.client.unreadCount(userId, activeOrganizationId),
    };
  }

  async markRead(
    userId: string,
    activeOrganizationId: string | null,
    id: string,
  ): Promise<NotificationView> {
    return toView(await this.client.markRead(userId, activeOrganizationId, id));
  }

  async markAllRead(
    userId: string,
    activeOrganizationId: string | null,
  ): Promise<{ updated: number }> {
    return this.client.markAllRead(userId, activeOrganizationId);
  }
}

/** Java row → the frontend NotificationView, byte-compatible with the old shape. */
export function toView(row: JavaNotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type as NotificationType,
    audience: row.audience as NotificationAudience,
    isRead: row.isRead,
    readAt: row.readAt,
    createdAt: row.createdAt,
    vacancy:
      row.vacancyId && row.vacancyTitle
        ? {
            id: row.vacancyId,
            title: row.vacancyTitle,
            deleted: row.type === 'VACANCY_DELETED',
          }
        : null,
    candidate:
      row.candidateId && row.candidateName
        ? { id: row.candidateId, name: row.candidateName }
        : null,
    actor: row.actorName ? { name: row.actorName } : null,
    applicationId: row.applicationId,
    conversationId: row.conversationId,
    messageId: row.messageId,
    messagePreview: row.messagePreview,
  };
}
