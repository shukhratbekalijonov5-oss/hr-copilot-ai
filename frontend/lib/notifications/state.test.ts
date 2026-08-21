import { describe, expect, it } from "vitest";
import {
  badgeLabel,
  markAllNotificationsRead,
  markNotificationRead,
  mergeNotifications,
  unreadCountAfterIncoming,
} from "@/lib/notifications/state";
import type { Notification } from "@/lib/types";

function notification(
  id: string,
  createdAt: string,
  isRead = false,
): Notification {
  return {
    id,
    type: "NEW_MESSAGE",
    audience: "HR",
    isRead,
    createdAt,
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
}

describe("notification state", () => {
  it("deduplicates fetched and realtime notifications by id", () => {
    const first = notification("a", "2026-08-20T10:00:00.000Z");
    const updated = { ...first, isRead: true };
    const second = notification("b", "2026-08-20T11:00:00.000Z");

    expect(mergeNotifications([first], [second, updated])).toEqual([
      second,
      updated,
    ]);
  });

  it("patches read state without changing the whole list", () => {
    const rows = [
      notification("a", "2026-08-20T10:00:00.000Z"),
      notification("b", "2026-08-20T11:00:00.000Z"),
    ];

    expect(markNotificationRead(rows, "a")).toEqual([
      { ...rows[0], isRead: true },
      rows[1],
    ]);
    expect(markAllNotificationsRead(rows).every((row) => row.isRead)).toBe(true);
  });

  it("keeps unread counts race-safe for incoming events", () => {
    const existing = notification("a", "2026-08-20T10:00:00.000Z");
    expect(unreadCountAfterIncoming([existing], existing, 1)).toBe(1);
    expect(
      unreadCountAfterIncoming(
        [existing],
        notification("b", "2026-08-20T11:00:00.000Z"),
        1,
      ),
    ).toBe(2);
    expect(
      unreadCountAfterIncoming(
        [existing],
        { ...existing, isRead: true },
        1,
      ),
    ).toBe(0);
  });

  it("formats compact badge counts", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(4)).toBe("4");
    expect(badgeLabel(120)).toBe("99+");
  });
});
