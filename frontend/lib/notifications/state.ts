import type { Notification } from "@/lib/types";

export function sortNotifications(
  notifications: Notification[],
): Notification[] {
  return [...notifications].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
      b.id.localeCompare(a.id),
  );
}

export function mergeNotifications(
  current: Notification[],
  incoming: Notification[],
): Notification[] {
  const byId = new Map(current.map((notification) => [notification.id, notification]));
  for (const notification of incoming) {
    byId.set(notification.id, {
      ...byId.get(notification.id),
      ...notification,
    });
  }
  return sortNotifications(Array.from(byId.values()));
}

export function markNotificationRead(
  notifications: Notification[],
  id: string,
): Notification[] {
  return notifications.map((notification) =>
    notification.id === id ? { ...notification, isRead: true } : notification,
  );
}

export function markAllNotificationsRead(
  notifications: Notification[],
): Notification[] {
  return notifications.map((notification) => ({ ...notification, isRead: true }));
}

export function unreadCountAfterIncoming(
  current: Notification[],
  incoming: Notification,
  unreadCount: number,
): number {
  const existing = current.find((notification) => notification.id === incoming.id);
  if (existing) {
    if (existing.isRead && !incoming.isRead) return unreadCount + 1;
    if (!existing.isRead && incoming.isRead) return Math.max(0, unreadCount - 1);
    return unreadCount;
  }
  return incoming.isRead ? unreadCount : unreadCount + 1;
}

export function badgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}
