import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * THE server-to-server client for the Java Notification Service — the
 * authoritative owner of notification rows and read/unread state. Every
 * HTTP call the backend makes to it goes through this class, service-
 * authenticated with `X-Internal-Token`, bounded by one timeout, and shape-
 * validated before anything downstream sees it. The token exists only in
 * this process's environment; no response type carries it and no upstream
 * error text ever travels toward a browser.
 *
 * Failure policy: notifications are a READ product surface — an outage is a
 * stable 503 (`NOTIFICATIONS_UNAVAILABLE`), never a silently empty list
 * that would tell a user their notifications vanished. A cross-user or
 * unknown id answers 404 upstream and stays a 404 here, indistinguishable
 * from non-existent — the same wall the old local implementation had.
 */
export interface JavaNotificationRow {
  id: string;
  type: string;
  audience: string;
  organizationId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  vacancyId: string | null;
  vacancyTitle: string | null;
  candidateId: string | null;
  candidateName: string | null;
  actorName: string | null;
  applicationId: string | null;
  conversationId: string | null;
  messageId: string | null;
  messagePreview: string | null;
}

export interface JavaNotificationList {
  data: JavaNotificationRow[];
  total: number;
}

export interface LegacyImportRow {
  eventId: string;
  recipientUserId: string;
  type: string;
  audience: string;
  organizationId: string | null;
  readAt: string | null;
  createdAt: string;
  context: Record<string, unknown>;
}

export const NOTIFICATIONS_UNAVAILABLE = 'NOTIFICATIONS_UNAVAILABLE';

@Injectable()
export class NotificationServiceClient {
  private readonly logger = new Logger(NotificationServiceClient.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .get<string>('notifications.serviceUrl', '')
      .trim()
      .replace(/\/+$/, '');
    this.token = config.get<string>('notifications.serviceToken', '').trim();
    this.timeoutMs = config.get<number>('notifications.timeoutMs', 2_500);
  }

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  async list(query: {
    userId: string;
    organizationId: string | null;
    page: number;
    limit: number;
    unreadOnly?: boolean;
    type?: string;
  }): Promise<JavaNotificationList> {
    const params = new URLSearchParams({
      userId: query.userId,
      page: String(query.page),
      limit: String(query.limit),
    });
    if (query.organizationId)
      params.set('organizationId', query.organizationId);
    if (query.unreadOnly) params.set('unreadOnly', 'true');
    if (query.type) params.set('type', query.type);

    const body = await this.request(
      `/internal/notifications?${params.toString()}`,
      { method: 'GET' },
      'notification list',
    );
    const parsed = body as Partial<JavaNotificationList>;
    if (!Array.isArray(parsed.data) || typeof parsed.total !== 'number') {
      this.logger.warn('Notification list response was malformed');
      throw this.unavailable();
    }
    return { data: parsed.data, total: parsed.total };
  }

  async unreadCount(
    userId: string,
    organizationId: string | null,
  ): Promise<number> {
    const params = new URLSearchParams({ userId });
    if (organizationId) params.set('organizationId', organizationId);
    const body = await this.request(
      `/internal/notifications/unread-count?${params.toString()}`,
      { method: 'GET' },
      'unread count',
    );
    const unread = (body as { unread?: unknown }).unread;
    if (typeof unread !== 'number') throw this.unavailable();
    return unread;
  }

  async markRead(
    userId: string,
    organizationId: string | null,
    id: string,
  ): Promise<JavaNotificationRow> {
    const body = await this.request(
      `/internal/notifications/${encodeURIComponent(id)}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, organizationId }),
      },
      'mark read',
    );
    return body as JavaNotificationRow;
  }

  async markAllRead(
    userId: string,
    organizationId: string | null,
  ): Promise<{ updated: number }> {
    const body = await this.request(
      '/internal/notifications/read-all',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, organizationId }),
      },
      'mark all read',
    );
    const updated = (body as { updated?: unknown }).updated;
    return { updated: typeof updated === 'number' ? updated : 0 };
  }

  /** One-time legacy backfill transport. Idempotent upstream on eventId. */
  async importLegacy(
    rows: LegacyImportRow[],
  ): Promise<{ imported: number; duplicates: number }> {
    const body = await this.request(
      '/internal/notifications/import',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      },
      'legacy import',
    );
    return body as { imported: number; duplicates: number };
  }

  /**
   * One transport core: base-URL guard, service credential, bounded
   * timeout. 404 → NotFoundException (the recipient wall's contract);
   * everything else that is not 2xx → stable 503.
   */
  private async request(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    what: string,
  ): Promise<unknown> {
    if (!this.configured) throw this.unavailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: { ...(init.headers ?? {}), 'X-Internal-Token': this.token },
        body: init.body,
        signal: controller.signal,
      });
      if (response.status === 404) {
        throw new NotFoundException('Notification not found');
      }
      if (!response.ok) {
        this.logger.warn(
          `Notification service answered ${response.status} for a ${what}`,
        );
        throw this.unavailable();
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      this.logger.warn(
        `Notification service ${what} failed: ${(error as Error).name || 'Error'}`,
      );
      throw this.unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Notifications are not available right now.',
      code: NOTIFICATIONS_UNAVAILABLE,
    });
  }
}
