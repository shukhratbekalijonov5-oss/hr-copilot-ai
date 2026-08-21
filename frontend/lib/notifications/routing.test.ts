import { describe, expect, it } from "vitest";
import { notificationHref } from "@/lib/notifications/routing";
import type { Notification } from "@/lib/types";

const base: Notification = {
  id: "n1",
  type: "NEW_MESSAGE",
  audience: "HR",
  isRead: false,
  createdAt: "2026-08-20T10:00:00.000Z",
  vacancyId: null,
  vacancyTitle: null,
  candidateId: null,
  candidateName: null,
  actorUserId: null,
  actorName: null,
  conversationId: null,
  messageId: null,
  interviewId: null,
  applicationId: null,
  messagePreview: null,
};

describe("notificationHref", () => {
  it("keeps HR new application routing in vacancy context", () => {
    expect(
      notificationHref({
        ...base,
        type: "NEW_APPLICATION",
        candidateId: "candidate-1",
        vacancyId: "vacancy-1",
      }),
    ).toBe("/candidates/candidate-1?vacancyId=vacancy-1");
  });

  it("routes HR messages to the existing interview chat selection", () => {
    expect(
      notificationHref({
        ...base,
        conversationId: "conversation-1",
        vacancyId: "vacancy-1",
      }),
    ).toBe("/interview-chats?conversation=conversation-1&vacancyId=vacancy-1");
  });

  it("routes candidate lifecycle events away from deleted vacancy pages", () => {
    expect(
      notificationHref({
        ...base,
        audience: "CANDIDATE",
        type: "VACANCY_DELETED",
      }),
    ).toBe("/my-applications");
  });
});
