import "server-only";

import {
  toNotification,
  type NotificationWire,
} from "@/lib/notifications/adapter";
import type { UnreadNotificationCountResponse } from "@/lib/api/contracts";
import { apiFetch, type Paginated } from "@/lib/api/http";
import type { Notification, NotificationPage, NotificationQuery } from "@/lib/types";

export async function getNotifications(
  query: NotificationQuery = {},
): Promise<NotificationPage> {
  const response = await apiFetch<Paginated<NotificationWire>>("/notifications", {
    query: {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      unreadOnly: query.unreadOnly,
      type: query.type,
    },
  });

  return {
    notifications: response.data.map(toNotification),
    total: response.meta.total,
    page: response.meta.page,
    limit: response.meta.limit,
    totalPages: response.meta.totalPages,
  };
}

export async function getUnreadNotificationCount(): Promise<number> {
  const response = await apiFetch<UnreadNotificationCountResponse>(
    "/notifications/unread-count",
  );

  return response.unread ?? response.unreadCount ?? response.count ?? 0;
}

export async function markNotificationRead(id: string): Promise<Notification> {
  return toNotification(
    await apiFetch<NotificationWire>(`/notifications/${id}/read`, {
      method: "PATCH",
    }),
  );
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const response = await apiFetch<{ updated?: number }>(
    "/notifications/read-all",
    { method: "POST" },
  );
  return { updated: response.updated ?? 0 };
}
