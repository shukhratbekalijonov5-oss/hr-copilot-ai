import { queryKeys } from "@/lib/query/keys";
import { usePagedQuery } from "@/lib/query/pagination";
import { conversationBase } from "@/features/chat/messages";
import type { Conversation } from "@/types";

/**
 * Interview conversations.
 *
 * The candidate and recruiter sides are separate endpoints on the backend —
 * that separation is the backend's scoping rule, not a UI preference, so the
 * hook takes the audience rather than guessing from context.
 */
export function useConversations(audience: "candidate" | "recruiter") {
  return usePagedQuery<Conversation>(
    [...queryKeys.chat.conversations, audience],
    conversationBase(audience),
  );
}
