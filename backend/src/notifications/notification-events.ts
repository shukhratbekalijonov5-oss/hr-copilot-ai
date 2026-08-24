import type {
  NotificationAudience,
  NotificationType,
} from '../generated/prisma/enums';

/**
 * The Kafka contracts between the backend and the Java Notification Service.
 *
 * ## Topics
 *
 * `notifications.events.v1` — backend → Java. One message per (logical
 * notification, recipient); the Java side is the authoritative store and
 * dedupes on `eventId`, so at-least-once delivery meets a unique constraint.
 *
 * `notifications.created.v1` — Java → backend. The realtime echo: after the
 * Java service persists a notification (whatever its origin — a backend
 * business event, a payment event, the expiry scheduler), it announces the
 * created row here and the backend bridges it onto the existing websocket.
 *
 * ## Context discipline
 *
 * `context` carries ONLY what rendering needs: ids, display snapshots, a
 * clipped plain-text message preview. Never credentials, tokens, documents,
 * payment data or free-form user HTML.
 */
export const NOTIFICATION_EVENTS_TOPIC = 'notifications.events.v1';
export const NOTIFICATION_CREATED_TOPIC = 'notifications.created.v1';
export const NOTIFICATION_EVENT_VERSION = 1;

/**
 * Event types the backend emits. The Java service owns the full enum
 * (payment/scheduler types included); this union is only what THIS side
 * produces.
 */
export type OutboundNotificationEventType =
  NotificationType | 'ACCOUNT_CREATED';

/** The safe, minimal render context for one notification. */
export interface NotificationEventContext {
  audience: NotificationAudience;
  organizationId?: string | null;
  vacancyId?: string | null;
  vacancyTitle?: string | null;
  candidateId?: string | null;
  candidateName?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  applicationId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  messagePreview?: string | null;
  /** ACCOUNT_CREATED only. */
  accountType?: string;
}

/** The envelope published on notifications.events.v1. */
export interface NotificationEventEnvelope {
  eventId: string;
  eventVersion: number;
  eventType: string;
  occurredAt: string;
  recipientUserId: string;
  context: NotificationEventContext;
}
