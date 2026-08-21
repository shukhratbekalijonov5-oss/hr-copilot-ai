import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/dictionaries/en";
import { toNotification } from "@/lib/notifications/adapter";
import { notificationPresentation } from "@/lib/notifications/presentation";

describe("notificationPresentation", () => {
  it("emphasizes HR candidate, vacancy, and message preview", () => {
    const notification = toNotification({
      id: "n1",
      type: "NEW_MESSAGE",
      audience: "HR",
      isRead: false,
      createdAt: "2026-08-20T10:00:00.000Z",
      candidateName: "Sarah Lee",
      vacancyTitle: "DevOps Engineer",
      messagePreview: "<b>Hello</b>",
    });

    expect(notificationPresentation(notification, en)).toEqual({
      title: "New message",
      primary: "Sarah Lee",
      secondary: "DevOps Engineer",
      preview: "<b>Hello</b>",
    });
  });

  it("uses localized fallbacks for missing candidate data", () => {
    const notification = toNotification({
      id: "n2",
      type: "NEW_APPLICATION",
      audience: "HR",
      isRead: false,
      createdAt: "2026-08-20T10:00:00.000Z",
    });

    expect(notificationPresentation(notification, en).primary).toBe(
      "Candidate unavailable",
    );
  });

  it("uses candidate-side recruiter context for interview invites", () => {
    const notification = toNotification({
      id: "n3",
      type: "INTERVIEW_INVITATION",
      audience: "CANDIDATE",
      isRead: false,
      createdAt: "2026-08-20T10:00:00.000Z",
      actorName: "Mina Park",
      vacancyTitle: "Frontend Engineer",
    });

    expect(notificationPresentation(notification, en)).toMatchObject({
      title: "Interview invitation",
      primary: "Mina Park",
      secondary: "Frontend Engineer",
    });
  });
});
