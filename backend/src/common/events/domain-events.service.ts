import { Injectable, Logger } from '@nestjs/common';
import type {
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
 * Every in-process domain event and its payload. Kept deliberately small:
 * the planned notification system consumes `interview.invited`,
 * `application.rejected` and `vacancy.closed`; the `chat.*` events are the
 * realtime fan-out used by the chat gateway today.
 */
export interface DomainEventMap {
  'interview.invited': {
    organizationId: string;
    vacancyId: string;
    applicationId: string;
    candidateId: string;
    /** null for manual/external candidates with no platform account. */
    candidateAccountId: string | null;
    /** null when no chat could be unlocked (no platform account). */
    conversationId: string | null;
  };
  'application.rejected': {
    organizationId: string;
    vacancyId: string;
    applicationId: string;
    candidateId: string;
    candidateAccountId: string | null;
    /**
     * The conversation hard-deleted by this rejection, or null when the
     * candidate had never been invited to interview (nothing existed to
     * delete).
     */
    deletedConversationId: string | null;
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
