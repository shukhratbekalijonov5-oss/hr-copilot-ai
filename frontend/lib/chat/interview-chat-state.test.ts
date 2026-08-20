import { describe, expect, it } from "vitest";
import {
  bumpConversationUpdatedAt,
  isCurrentConversationClosed,
  mergeMessageById,
  removeClosedConversation,
} from "@/lib/chat/interview-chat-state";
import type {
  InterviewMessage,
  OrganizationInterviewConversation,
} from "@/lib/types";

const conversation = (
  id: string,
  candidateId: string,
  vacancyId = "vacancy-1",
): OrganizationInterviewConversation => ({
  side: "organization",
  id,
  vacancyId,
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
  vacancy: { id: vacancyId, title: "Backend Engineer", status: "OPEN" },
  candidate: {
    id: candidateId,
    fullName: `Candidate ${candidateId}`,
    email: `${candidateId}@example.test`,
  },
});

const message = (id: string, conversationId = "conv-a"): InterviewMessage => ({
  id,
  conversationId,
  senderParty: "ORGANIZATION",
  senderName: "Recruiter",
  content: `Message ${id}`,
  createdAt: id === "m1" ? "2026-08-20T10:01:00.000Z" : "2026-08-20T10:02:00.000Z",
});

describe("interview chat state", () => {
  it("deduplicates REST send results and message.new by authoritative id", () => {
    const first = mergeMessageById([], message("m1"));
    const duplicate = mergeMessageById(first, message("m1"));

    expect(duplicate).toBe(first);
    expect(duplicate).toHaveLength(1);
  });

  it("removes only the rejected candidate conversation", () => {
    const conversations = [
      conversation("conv-a", "candidate-a"),
      conversation("conv-b", "candidate-b"),
      conversation("conv-c", "candidate-a", "vacancy-2"),
    ];

    expect(
      removeClosedConversation(conversations, {
        conversationId: "conv-a",
        reason: "CANDIDATE_REJECTED",
      }).map((item) => item.id),
    ).toEqual(["conv-b", "conv-c"]);
  });

  it("treats vacancy close as permanent removal for the affected conversation", () => {
    expect(
      isCurrentConversationClosed("conv-a", {
        conversationId: "conv-a",
        reason: "VACANCY_CLOSED",
      }),
    ).toBe(true);
  });

  it("accepts a re-invite as a fresh conversation id", () => {
    const afterReject = removeClosedConversation([conversation("old", "a")], {
      conversationId: "old",
      reason: "CANDIDATE_REJECTED",
    });
    const reinvited = [conversation("new", "a"), ...afterReject];

    expect(reinvited.map((item) => item.id)).toEqual(["new"]);
  });

  it("bumps a conversation when a realtime message arrives", () => {
    const bumped = bumpConversationUpdatedAt(
      [conversation("conv-a", "a"), conversation("conv-b", "b")],
      message("m2", "conv-b"),
    );

    expect(bumped[0].id).toBe("conv-b");
    expect(bumped[0].updatedAt).toBe("2026-08-20T10:02:00.000Z");
  });
});
