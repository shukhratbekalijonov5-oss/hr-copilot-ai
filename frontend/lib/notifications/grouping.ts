import type { Notification } from "@/lib/types";

/**
 * Time buckets for the notification list.
 *
 * ## Why group at all
 *
 * An undifferentiated column of rows makes "is there anything new" a reading
 * task. Three headings answer it at a glance, and they are the only three a
 * reader actually distinguishes in a dropdown: today, this week, and older.
 *
 * ## Computed against a passed-in `now`
 *
 * The caller supplies the instant, so this is a pure function with no clock of
 * its own — testable, and identical on the server pass and after hydration.
 * Buckets are calendar-relative, not "24 hours ago": something from 11pm last
 * night belongs under Earlier, not Today, which is what a reader means.
 */
export type NotificationBucket = "today" | "week" | "earlier";

export interface NotificationGroup {
  bucket: NotificationBucket;
  notifications: Notification[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function bucketFor(createdAt: string, now: number): NotificationBucket {
  const created = new Date(createdAt).getTime();
  // An unparseable date sorts with the oldest rather than pretending to be new.
  if (!Number.isFinite(created)) return "earlier";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (created >= startOfToday.getTime()) return "today";
  if (created >= startOfToday.getTime() - 6 * DAY_MS) return "week";
  return "earlier";
}

/**
 * Groups an already-sorted list, preserving its order.
 *
 * Order is the caller's — the list arrives newest-first from the API and from
 * `sortNotifications`, and re-sorting here would make two places responsible
 * for it. Empty buckets are omitted rather than rendered as bare headings.
 */
export function groupNotifications(
  notifications: Notification[],
  now: number,
): NotificationGroup[] {
  const groups: NotificationGroup[] = [];

  for (const notification of notifications) {
    const bucket = bucketFor(notification.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.bucket === bucket) last.notifications.push(notification);
    else groups.push({ bucket, notifications: [notification] });
  }

  return groups;
}
