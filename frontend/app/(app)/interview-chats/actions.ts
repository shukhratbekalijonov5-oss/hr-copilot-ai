"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type {
  InterviewMessage,
  OrganizationInterviewConversation,
} from "@/lib/types";

export type ChatActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "not_found" | "unauthorized" | "network" | "invalid" | "error";
      message?: string;
    };

function failure(error: unknown): ChatActionResult<never> {
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

export async function loadOrganizationConversationAction(
  conversationId: string,
): Promise<
  ChatActionResult<{
    conversation: OrganizationInterviewConversation;
    messages: InterviewMessage[];
  }>
> {
  try {
    const [conversation, page] = await Promise.all([
      api.getOrganizationConversation(conversationId),
      api.getOrganizationMessages(conversationId, { page: 1, limit: 100 }),
    ]);
    return { ok: true, data: { conversation, messages: page.messages } };
  } catch (error) {
    return failure(error);
  }
}

export async function sendOrganizationMessageAction(
  conversationId: string,
  content: string,
): Promise<ChatActionResult<InterviewMessage>> {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, reason: "invalid" };

  try {
    return {
      ok: true,
      data: await api.sendOrganizationMessage(conversationId, trimmed),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function closeVacancyAction(
  vacancyId: string,
): Promise<ChatActionResult<{ id: string }>> {
  try {
    const vacancy = await api.setVacancyStatus(vacancyId, "CLOSED");
    revalidatePath(`/vacancies/${vacancyId}`);
    revalidatePath("/vacancies");
    revalidatePath("/dashboard");
    revalidatePath("/interview-chats");
    return { ok: true, data: { id: vacancy.id } };
  } catch (error) {
    return failure(error);
  }
}
