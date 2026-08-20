"use server";

import { api, ApiError } from "@/lib/api";
import type {
  CandidateInterviewConversation,
  InterviewMessage,
} from "@/lib/types";

export type CandidateChatActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "not_found" | "unauthorized" | "network" | "invalid" | "error";
      message?: string;
    };

function failure(error: unknown): CandidateChatActionResult<never> {
  if (error instanceof ApiError) {
    if (error.kind === "not_found") return { ok: false, reason: "not_found" };
    if (error.kind === "network") return { ok: false, reason: "network" };
    if (error.status === 401 || error.status === 403) {
      return { ok: false, reason: "unauthorized", message: error.message };
    }
    if (error.status === 400) {
      return { ok: false, reason: "invalid", message: error.message };
    }
    return { ok: false, reason: "error", message: error.message };
  }
  return { ok: false, reason: "error" };
}

export async function loadCandidateConversationAction(
  conversationId: string,
): Promise<
  CandidateChatActionResult<{
    conversation: CandidateInterviewConversation;
    messages: InterviewMessage[];
  }>
> {
  try {
    const [conversation, page] = await Promise.all([
      api.getCandidateConversation(conversationId),
      api.getCandidateMessages(conversationId, { page: 1, limit: 100 }),
    ]);
    return { ok: true, data: { conversation, messages: page.messages } };
  } catch (error) {
    return failure(error);
  }
}

export async function sendCandidateMessageAction(
  conversationId: string,
  content: string,
): Promise<CandidateChatActionResult<InterviewMessage>> {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, reason: "invalid" };

  try {
    return {
      ok: true,
      data: await api.sendCandidateMessage(conversationId, trimmed),
    };
  } catch (error) {
    return failure(error);
  }
}
