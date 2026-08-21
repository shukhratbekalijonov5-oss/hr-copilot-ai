import { Injectable, Logger } from '@nestjs/common';
import type {
  ApplicationStatus,
  ConversationParty,
  VacancyStatus,
} from '../../generated/prisma/enums';

/**
 * Why a conversation was hard-deleted. Both reasons are permanent and
 * immediate — there is no archived or read-only chat state in this product.
 */
export type ConversationDeletionReason =
  /** The vacancy stopped being live: ALL of its conversations went with it. */
  | 'VACANCY_CLOSED'
  /** ONE candidate was rejected: only their conversation on that vacancy went. */
  | 'CANDIDATE_REJECTED'
  /**
   * The application row itself was deleted, taking the hiring relationship —
   * and therefore that one conversation — with it.
   */
  | 'APPLICATION_DELETED';

/** A chat message as both sides are allowed to see it. */
export interface ConversationMessageView {
  id: string;
  conversationId: string;
  senderParty: ConversationParty;
  senderName: string;
  content: string;
  createdAt: Date;
}

/**
 * Every in-process domain event and its payload. Kept deliberately small: the
 * notification system consumes `application.created`, `chat.message.created`,
 * `interview.invited`, `application.rejected` and `vacancy.deleted`; the
 * `chat.*` events are the realtime fan-out used by the chat gateway.
 */
export interface DomainEventMap {
  /**
   * A candidate applied to a vacancy and the row is committed. There is only
   * one producer (PublicJobsService.apply) and one shape of application, so
   * consumers need no source check: every one of these is a real person
   * applying to somebody's vacancy.
   */
  'application.created': {
    organizationId: string;
    vacancyId: string;
    applicationId: string;
    candidateId: string;
  };
  'interview.invited': {
    organizationId: string;
    vacancyId: string;
    applicationId: string;
    candidateId: string;
    /** The account the candidate applied with — every applicant has one. */
    candidateAccountId: string;
    conversationId: string;
    /** The HR user who performed the invitation. */
    actorUserId: string;
    /**
     * The application's status BEFORE this invite. Lets consumers detect a
     * genuine transition — a re-invite (INTERVIEW → INTERVIEW) is idempotent
     * and must not notify again.
     */
    previousStatus: ApplicationStatus;
  };
  'application.rejected': {
    organizationId: string;
    vacancyId: string;
    applicationId: string;
    candidateId: string;
    /** The account the candidate applied with — every applicant has one. */
    candidateAccountId: string;
    /**
     * The conversation hard-deleted by this rejection, or null when the
     * candidate had never been invited to interview (nothing existed to
     * delete).
     */
    deletedConversationId: string | null;
    /**
     * Status BEFORE the rejection. REJECTED → REJECTED re-saves are not a
     * transition and must not re-notify the candidate.
     */
    previousStatus: ApplicationStatus;
  };
  /**
   * A vacancy row was permanently deleted (single or bulk). Published once
   * PER vacancy, strictly AFTER the delete transaction committed — a failed
   * or rolled-back delete publishes nothing. `recipients` and the title were
   * captured BEFORE deletion, because the applications and the vacancy row
   * are gone by the time this fires.
   */
  'vacancy.deleted': {
    organizationId: string;
    vacancyId: string;
    vacancyTitle: string;
    actorUserId: string;
    /** Every applicant with a platform account — the only reachable ones. */
    recipients: { userId: string; candidateId: string }[];
  };
  /**
   * A notification row was persisted — the realtime fan-out signal. The chat
   * gateway forwards it to the recipient's `user:{id}` room; PostgreSQL is
   * already authoritative by the time this fires.
   */
  'notification.created': {
    recipientUserId: string;
    /** The API-shaped notification, exactly as GET /notifications returns. */
    notification: unknown;
  };
  /** Published only for genuine transitions into CLOSED (never re-published). */
  'vacancy.closed': {
    organizationId: string;
    vacancyId: string;
    deletedConversationIds: string[];
  };
  /** Realtime fan-out: a persisted message ready to broadcast to its room. */
  'chat.message.created': {
    conversationId: string;
    message: ConversationMessageView;
    /** The authenticated sender — lets consumers exclude self-notification. */
    senderUserId: string;
  };
  /**
   * Conversations were HARD-DELETED — by a vacancy ending, or by one
   * candidate being rejected. Consumers must stop serving these rooms
   * immediately; the rows are already gone when this fires.
   */
  'chat.conversations.deleted': {
    vacancyId: string;
    reason: ConversationDeletionReason;
    /**
     * The vacancy status that triggered the purge. Null for reasons that are
     * not a vacancy transition (a rejection, or the vacancy row itself being
     * deleted).
     */
    vacancyStatus: VacancyStatus | null;
    conversationIds: string[];
  };
}

export type DomainEventName = keyof DomainEventMap;

type Handler<K extends DomainEventName> = (
  payload: DomainEventMap[K],
) => void | Promise<void>;

/**
 * Minimal typed in-process pub/sub. The project has no event bus (BullMQ is
 * document-processing only), and inventing a broker for five events would be
 * overreach — this keeps publishers decoupled from consumers so the future
 * notification system can subscribe without touching chat/pipeline logic.
 *
 * Delivery is best-effort and after-commit by convention: publishers emit only
 * once their database transaction has committed, and a throwing handler is
 * logged, never propagated back into the request that published.
 */
@Injectable()
export class DomainEventsService {
  private readonly logger = new Logger(DomainEventsService.name);
  private readonly handlers = new Map<DomainEventName, Handler<never>[]>();

  on<K extends DomainEventName>(event: K, handler: Handler<K>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  publish<K extends DomainEventName>(
    event: K,
    payload: DomainEventMap[K],
  ): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        const result = (handler as Handler<K>)(payload);
        if (result instanceof Promise) {
          result.catch((error: Error) => this.logFailure(event, error));
        }
      } catch (error) {
        this.logFailure(event, error as Error);
      }
    }
  }

  private logFailure(event: DomainEventName, error: Error): void {
    this.logger.error(`Handler for ${event} failed: ${error.message}`);
  }
}
