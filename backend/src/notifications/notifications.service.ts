import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import type {
  NotificationAudience,
  NotificationType,
} from '../generated/prisma/enums';
import type { Notification, Prisma } from '../generated/prisma/client';
import type { NotificationView } from './notification-view';
import type { QueryNotificationsDto } from './dto/query-notifications.dto';

/** Everything the create path may set. Recipients are NEVER client-supplied. */
export interface CreateNotificationInput {
  audience: NotificationAudience;
  type: NotificationType;
  recipientUserId: string;
  /** Set for HR-audience rows only; CANDIDATE rows are personal (null). */
  organizationId?: string | null;
  vacancyId?: string | null;
  candidateId?: string | null;
  applicationId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  actorUserId?: string | null;
  vacancyTitleSnapshot?: string | null;
  candidateNameSnapshot?: string | null;
  actorNameSnapshot?: string | null;
  messagePreview?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Persistence + read API + realtime signal for notifications.
 *
 * PostgreSQL is the source of truth: `create` persists first, then publishes
 * `notification.created` for the socket fan-out — an offline recipient loses
 * only the push, never the notification. Recipient identity is always derived
 * by the LISTENER from trusted relationships; nothing here is reachable with
 * a client-chosen recipient.
 *
 * Read-side scoping: every query is anchored on the authenticated user id,
 * and HR rows are additionally confined to the caller's ACTIVE organization
 * (a multi-org recruiter sees each workspace's notifications inside that
 * workspace). Candidate rows carry no organization and always belong to
 * exactly one user. Cross-user ids resolve to 404, indistinguishable from
 * non-existent.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  async create(input: CreateNotificationInput): Promise<NotificationView> {
    const row = await this.prisma.notification.create({
      data: {
        audience: input.audience,
        type: input.type,
        recipientUserId: input.recipientUserId,
        organizationId: input.organizationId ?? null,
        vacancyId: input.vacancyId ?? null,
        candidateId: input.candidateId ?? null,
        applicationId: input.applicationId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        actorUserId: input.actorUserId ?? null,
        vacancyTitleSnapshot: input.vacancyTitleSnapshot ?? null,
        candidateNameSnapshot: input.candidateNameSnapshot ?? null,
        actorNameSnapshot: input.actorNameSnapshot ?? null,
        messagePreview: input.messagePreview ?? null,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });

    const view = toView(row);
    // Realtime is an optimization on top of the committed row — a failed or
    // missed emit is recovered by the next fetch, never by re-creating rows.
    this.events.publish('notification.created', {
      recipientUserId: row.recipientUserId,
      notification: view,
    });
    return view;
  }

  async list(
    userId: string,
    activeOrganizationId: string | null,
    query: QueryNotificationsDto,
  ): Promise<PaginatedResult<NotificationView>> {
    const where = this.recipientScope(userId, activeOrganizationId, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginated(rows.map(toView), total, query.page, query.limit);
  }

  async unreadCount(
    userId: string,
    activeOrganizationId: string | null,
  ): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: {
        ...this.recipientScope(userId, activeOrganizationId, {}),
        isRead: false,
      },
    });
    return { unread };
  }

  async markRead(
    userId: string,
    activeOrganizationId: string | null,
    id: string,
  ): Promise<NotificationView> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, ...this.recipientScope(userId, activeOrganizationId, {}) },
    });
    // Someone else's (or an unknown) id: 404, never confirming existence.
    if (!existing) throw new NotFoundException('Notification not found');

    if (existing.isRead) return toView(existing);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    return toView(updated);
  }

  async markAllRead(
    userId: string,
    activeOrganizationId: string | null,
  ): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        ...this.recipientScope(userId, activeOrganizationId, {}),
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: result.count };
  }

  /**
   * THE recipient filter, applied unconditionally to every read/update:
   * the caller's own rows only, with HR (organization-carrying) rows further
   * confined to the active workspace.
   */
  private recipientScope(
    userId: string,
    activeOrganizationId: string | null,
    query: Partial<QueryNotificationsDto>,
  ): Prisma.NotificationWhereInput {
    return {
      recipientUserId: userId,
      OR: [
        { organizationId: null },
        ...(activeOrganizationId
          ? [{ organizationId: activeOrganizationId }]
          : []),
      ],
      ...(query.unreadOnly ? { isRead: false } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
  }
}

function toView(row: Notification): NotificationView {
  return {
    id: row.id,
    type: row.type,
    audience: row.audience,
    isRead: row.isRead,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    vacancy:
      row.vacancyId && row.vacancyTitleSnapshot
        ? {
            id: row.vacancyId,
            title: row.vacancyTitleSnapshot,
            deleted: row.type === 'VACANCY_DELETED',
          }
        : null,
    candidate:
      row.candidateId && row.candidateNameSnapshot
        ? { id: row.candidateId, name: row.candidateNameSnapshot }
        : null,
    actor: row.actorNameSnapshot ? { name: row.actorNameSnapshot } : null,
    applicationId: row.applicationId,
    conversationId: row.conversationId,
    messageId: row.messageId,
    messagePreview: row.messagePreview,
  };
}
