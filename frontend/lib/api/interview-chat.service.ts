import "server-only";

import { apiFetch, type Paginated } from "@/lib/api/http";
import {
  toCandidateConversation,
  toInterviewMessage,
  toInviteToInterviewResult,
  toOrganizationConversation,
} from "@/lib/api/adapters";
import type {
  CandidateConversationResponse,
  ConversationMessageResponse,
  InviteToInterviewResponse,
  OrganizationConversationResponse,
} from "@/lib/api/contracts";
import type {
  CandidateInterviewConversation,
  InterviewConversationPage,
  InterviewMessage,
  InviteToInterviewResult,
  OrganizationInterviewConversation,
} from "@/lib/types";

export async function inviteToInterview(
  applicationId: string,
): Promise<InviteToInterviewResult> {
  return toInviteToInterviewResult(
    await apiFetch<InviteToInterviewResponse>(
      `/applications/${applicationId}/invite-interview`,
      { method: "POST" },
    ),
  );
}

export async function getOrganizationConversations(
  query: { vacancyId?: string; page?: number; limit?: number } = {},
): Promise<InterviewConversationPage<OrganizationInterviewConversation>> {
  const response = await apiFetch<Paginated<OrganizationConversationResponse>>(
    "/conversations",
    {
      query: {
        vacancyId: query.vacancyId,
        page: query.page ?? 1,
        limit: query.limit ?? 100,
      },
    },
  );

  return {
    conversations: response.data.map(toOrganizationConversation),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

export async function getOrganizationConversation(
  id: string,
): Promise<OrganizationInterviewConversation> {
  return toOrganizationConversation(
    await apiFetch<OrganizationConversationResponse>(`/conversations/${id}`),
  );
}

export async function getOrganizationMessages(
  conversationId: string,
  query: { page?: number; limit?: number } = {},
): Promise<{ messages: InterviewMessage[]; total: number }> {
  const response = await apiFetch<Paginated<ConversationMessageResponse>>(
    `/conversations/${conversationId}/messages`,
    { query: { page: query.page ?? 1, limit: query.limit ?? 100 } },
  );

  return {
    messages: response.data.map(toInterviewMessage),
    total: response.meta.total,
  };
}

export async function sendOrganizationMessage(
  conversationId: string,
  content: string,
): Promise<InterviewMessage> {
  return toInterviewMessage(
    await apiFetch<ConversationMessageResponse>(
      `/conversations/${conversationId}/messages`,
      { method: "POST", body: { content } },
    ),
  );
}

export async function getCandidateConversations(
  query: { page?: number; limit?: number } = {},
): Promise<InterviewConversationPage<CandidateInterviewConversation>> {
  const response = await apiFetch<Paginated<CandidateConversationResponse>>(
    "/candidate-account/me/conversations",
    { query: { page: query.page ?? 1, limit: query.limit ?? 100 } },
  );

  return {
    conversations: response.data.map(toCandidateConversation),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

export async function getCandidateConversation(
  id: string,
): Promise<CandidateInterviewConversation> {
  return toCandidateConversation(
    await apiFetch<CandidateConversationResponse>(
      `/candidate-account/me/conversations/${id}`,
    ),
  );
}

export async function getCandidateMessages(
  conversationId: string,
  query: { page?: number; limit?: number } = {},
): Promise<{ messages: InterviewMessage[]; total: number }> {
  const response = await apiFetch<Paginated<ConversationMessageResponse>>(
    `/candidate-account/me/conversations/${conversationId}/messages`,
    { query: { page: query.page ?? 1, limit: query.limit ?? 100 } },
  );

  return {
    messages: response.data.map(toInterviewMessage),
    total: response.meta.total,
  };
}

export async function sendCandidateMessage(
  conversationId: string,
  content: string,
): Promise<InterviewMessage> {
  return toInterviewMessage(
    await apiFetch<ConversationMessageResponse>(
      `/candidate-account/me/conversations/${conversationId}/messages`,
      { method: "POST", body: { content } },
    ),
  );
}
