import type {
  NotificationAudience,
  NotificationType,
} from '../generated/prisma/enums';

/**
 * The API shape of one notification — STRUCTURED data the frontend renders in
 * the viewer's locale (en/ko/ru/uz). Deliberately no pre-rendered sentence:
 * storing "Your applied vacancy X was deleted" in English would break three
 * languages. Related entities appear as ids + display snapshots so the card
 * still renders after the underlying rows are gone.
 */
export interface NotificationView {
  id: string;
  type: NotificationType;
  audience: NotificationAudience;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;

  /** `deleted` is true for VACANCY_DELETED — the id must NOT be linked. */
  vacancy: { id: string; title: string; deleted: boolean } | null;
  candidate: { id: string; name: string } | null;
  /** The person who acted (message sender, inviting HR). Name is a snapshot. */
  actor: { name: string } | null;

  applicationId: string | null;
  conversationId: string | null;
  messageId: string | null;

  /** Plain-text excerpt of a chat message (≤120 chars). Never HTML. */
  messagePreview: string | null;
}

/** Chat previews are clipped server-side; the client only ever escapes text. */
export const MESSAGE_PREVIEW_LENGTH = 120;

export function toMessagePreview(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > MESSAGE_PREVIEW_LENGTH
    ? `${collapsed.slice(0, MESSAGE_PREVIEW_LENGTH - 1)}…`
    : collapsed;
}
