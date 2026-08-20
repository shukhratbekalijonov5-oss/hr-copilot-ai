import type {
  InterviewChatClosedReason,
  InterviewConversation,
  InterviewMessage,
} from "@/lib/types";

export interface ConversationClosedEvent {
  conversationId: string;
  reason: InterviewChatClosedReason;
}

export function mergeMessageById(
  messages: InterviewMessage[],
  incoming: InterviewMessage,
): InterviewMessage[] {
  if (messages.some((message) => message.id === incoming.id)) return messages;
  return [...messages, incoming].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function removeClosedConversation<T extends InterviewConversation>(
  conversations: T[],
  event: ConversationClosedEvent,
): T[] {
  return conversations.filter(
    (conversation) => conversation.id !== event.conversationId,
  );
}

export function isCurrentConversationClosed(
  activeConversationId: string | null,
  event: ConversationClosedEvent,
): boolean {
  return activeConversationId === event.conversationId;
}

export function bumpConversationUpdatedAt<T extends InterviewConversation>(
  conversations: T[],
  message: InterviewMessage,
): T[] {
  return conversations
    .map((conversation) =>
      conversation.id === message.conversationId
        ? { ...conversation, updatedAt: message.createdAt }
        : conversation,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
