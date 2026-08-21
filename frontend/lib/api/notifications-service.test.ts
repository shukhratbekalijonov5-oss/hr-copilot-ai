import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api/http";
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/notifications.service";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

describe("notifications service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps paginated notification responses", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      data: [
        {
          id: "n1",
          type: "NEW_APPLICATION",
          audience: "HR",
          isRead: false,
          createdAt: "2026-08-20T10:00:00.000Z",
          vacancy: { id: "v1", title: "Backend Engineer" },
          candidate: { id: "c1", name: "John Kim" },
        },
      ],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    await expect(getNotifications({ page: 1, limit: 20 })).resolves.toEqual({
      notifications: [
        expect.objectContaining({
          id: "n1",
          vacancyId: "v1",
          vacancyTitle: "Backend Engineer",
          candidateId: "c1",
          candidateName: "John Kim",
        }),
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(apiFetch).toHaveBeenCalledWith("/notifications", {
      query: { page: 1, limit: 20, unreadOnly: undefined, type: undefined },
    });
  });

  it("accepts unread count response aliases", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ unreadCount: 7 });
    await expect(getUnreadNotificationCount()).resolves.toBe(7);
  });

  it("marks one notification as read", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: "n1",
      type: "NEW_MESSAGE",
      audience: "CANDIDATE",
      isRead: true,
      createdAt: "2026-08-20T10:00:00.000Z",
    });

    await expect(markNotificationRead("n1")).resolves.toMatchObject({
      id: "n1",
      isRead: true,
    });
    expect(apiFetch).toHaveBeenCalledWith("/notifications/n1/read", {
      method: "PATCH",
    });
  });

  it("marks all notifications as read", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ updated: 3 });
    await expect(markAllNotificationsRead()).resolves.toEqual({ updated: 3 });
  });
});
