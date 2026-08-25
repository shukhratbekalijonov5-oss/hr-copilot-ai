"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/LoadingSkeleton";
import { AlertIcon, BellIcon, CheckIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { parseNotification } from "@/lib/notifications/adapter";
import {
  notificationErrorText,
  toNotificationRequestError,
} from "@/lib/notifications/errors";
import {
  badgeLabel,
  markAllNotificationsRead,
  markNotificationRead,
  mergeNotifications,
  unreadCountAfterIncoming,
} from "@/lib/notifications/state";
import {
  emptyNotificationText,
  notificationPresentation,
} from "@/lib/notifications/presentation";
import {
  groupNotifications,
  type NotificationBucket,
} from "@/lib/notifications/grouping";
import { notificationHref } from "@/lib/notifications/routing";
import { cn } from "@/lib/utils";
import { OPEN_NOTIFICATIONS_EVENT } from "@/lib/ui/notifications-bus";
import type {
  Notification,
  NotificationAudience,
  NotificationPage,
} from "@/lib/types";

interface NotificationBellProps {
  audience: NotificationAudience;
  initialUnreadCount: number;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    // The handler's `code` travels with the error so the catch site can pick
    // localized copy for a failure the product recognises.
    throw toNotificationRequestError(payload, "Request failed.");
  }
  return payload as T;
}

function normalizePage(value: NotificationPage): NotificationPage {
  return {
    ...value,
    notifications: value.notifications
      .map((notification) => parseNotification(notification))
      .filter((notification): notification is Notification => Boolean(notification)),
  };
}

export function NotificationBell({
  audience,
  initialUnreadCount,
}: NotificationBellProps) {
  const router = useRouter();
  const { d } = useI18n();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    The instant the buckets are measured against, captured when the panel
    opens rather than read during render. Reading the clock while rendering
    makes the output depend on WHEN React happened to re-run this component;
    one timestamp per open keeps every row in a session bucketed consistently.
  */
  const [openedAt, setOpenedAt] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<Notification[]>([]);

  const label = badgeLabel(unreadCount);
  const emptyText = useMemo(
    () => emptyNotificationText(audience, d),
    [audience, d],
  );

  const refreshCount = useCallback(async () => {
    const response = await fetch("/api/notifications/unread-count", {
      cache: "no-store",
    });
    const payload = await readJson<{ unread: number }>(response);
    setUnreadCount(payload.unread);
  }, []);

  const loadPage = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          limit: audience === "HR" ? "20" : "12",
        });
        const response = await fetch(`/api/notifications?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = normalizePage(await readJson<NotificationPage>(response));
        const visible = payload.notifications.filter(
          (notification) => notification.audience === audience,
        );
        setNotifications((current) => mergeNotifications(current, visible));
        setPage(payload.page);
        setTotalPages(payload.totalPages);
      } catch (caught) {
        setError(
          notificationErrorText(
            caught,
            d.notifications.errors.load,
            d.notifications.errors,
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [audience, d.notifications.errors],
  );

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  /*
   * The mobile More sheet has no notifications route to send anyone to — the
   * web product's notification surface IS this dropdown — so it asks the bell
   * to open rather than a page being invented for it.
   */
  useEffect(() => {
    function onOpenRequest() {
      setOpen(true);
      setOpenedAt(Date.now());
      // Loading happens HERE, in the event that opens the panel, rather than
      // in an effect watching `open` — an effect would set state during
      // commit for something the opening event already knows.
      void loadPage(1);
    }
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, onOpenRequest);
    return () =>
      window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, onOpenRequest);
  }, [loadPage]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const source = new EventSource("/api/notifications/stream");

    source.addEventListener("notification", (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const notification = parseNotification(raw);
      if (!notification || notification.audience !== audience) return;
      setNotifications((current) => mergeNotifications(current, [notification]));
      setUnreadCount((current) =>
        unreadCountAfterIncoming(
          notificationsRef.current,
          notification,
          current,
        ),
      );
    });
    source.addEventListener("ready", () => {
      void refreshCount().catch(() => undefined);
    });

    return () => source.close();
  }, [audience, refreshCount]);

  async function markRead(notification: Notification) {
    if (!notification.isRead) {
      setNotifications((current) =>
        markNotificationRead(current, notification.id),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
      try {
        const response = await fetch(
          `/api/notifications/${notification.id}/read`,
          { method: "PATCH", cache: "no-store" },
        );
        const updated = parseNotification(await readJson<Notification>(response));
        if (updated) {
          setNotifications((current) => mergeNotifications(current, [updated]));
        }
      } catch (caught) {
        setError(
          notificationErrorText(
            caught,
            d.notifications.errors.markRead,
            d.notifications.errors,
          ),
        );
        void refreshCount().catch(() => undefined);
      }
    }
  }

  async function activateNotification(
    notification: Notification,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    await markRead(notification);
    const href = notificationHref(notification);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    setError(null);
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        cache: "no-store",
      });
      await readJson<{ updated: number }>(response);
      setNotifications((current) => markAllNotificationsRead(current));
      setUnreadCount(0);
    } catch (caught) {
      setError(
        notificationErrorText(
          caught,
          d.notifications.errors.markAll,
          d.notifications.errors,
        ),
      );
      void refreshCount().catch(() => undefined);
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) {
            setOpenedAt(Date.now());
            if (page === 0 && !loading) void loadPage(1);
          }
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unreadCount > 0
            ? d.notifications.bellUnreadLabel.replace(
                "{count}",
                String(unreadCount),
              )
            : d.notifications.bellLabel
        }
        className="relative flex size-9 items-center justify-center rounded-[10px] text-ink-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted hover:text-ink"
      >
        <BellIcon className="size-5" />
        {label ? (
          <span className="absolute right-0.5 top-0.5 grid min-w-4 translate-x-1/3 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-surface">
            {label}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          role="dialog"
          aria-label={d.notifications.title}
          className={cn(
            "animate-pop-in fixed right-3 top-16 z-50 max-h-[min(34rem,calc(100dvh-5rem))] w-[calc(100vw-1.5rem)] overflow-hidden rounded-[14px] border border-line bg-surface shadow-pop sm:absolute sm:right-0 sm:top-[calc(100%+0.6rem)] sm:w-[min(100vw-2rem,26rem)]",
            audience === "HR"
              ? "sm:w-[min(100vw-2rem,30rem)]"
              : "sm:w-[min(100vw-2rem,25rem)]",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                {d.notifications.title}
              </h2>
              <p className="text-xs text-ink-muted">
                {unreadCount > 0
                  ? d.notifications.unread.replace(
                      "{count}",
                      String(unreadCount),
                    )
                  : d.notifications.allCaughtUp}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<CheckIcon className="size-4" />}
              loading={markingAll}
              disabled={unreadCount === 0}
              onClick={markAllRead}
            >
              {d.notifications.markAllRead}
            </Button>
          </div>

          {error ? (
            <div className="border-b border-line bg-critical-soft px-4 py-2.5 text-[13px] text-critical">
              {error}
            </div>
          ) : null}

          <div className="max-h-[25rem] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="space-y-3 p-4">
                <NotificationSkeleton />
                <NotificationSkeleton />
                <NotificationSkeleton />
              </div>
            ) : notifications.length === 0 ? (
              <EmptyState
                icon={<BellIcon className="size-5" />}
                title={emptyText.title}
                description={emptyText.description}
                className="py-10"
              />
            ) : (
              /*
                Grouped by when, so "anything new?" is answered by the first
                heading rather than by reading timestamps. `now` is captured
                once per render so every row in a pass buckets against the
                same instant.
              */
              <div>
                {groupNotifications(notifications, openedAt).map((group) => (
                  <section key={group.bucket}>
                    <h3 className="sticky top-0 z-10 bg-surface/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-subtle backdrop-blur-sm">
                      {bucketLabel(group.bucket, d)}
                    </h3>
                    <ul className="divide-y divide-line border-b border-line last:border-b-0">
                      {group.notifications.map((notification) => (
                        <li key={notification.id}>
                          <NotificationCard
                            notification={notification}
                            audience={audience}
                            onClick={activateNotification}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>

          {page < totalPages ? (
            <div className="border-t border-line p-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                loading={loading}
                onClick={() => void loadPage(page + 1)}
              >
                {d.notifications.loadMore}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function NotificationSkeleton() {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex gap-3">
        <Skeleton className="size-2 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

function NotificationCard({
  notification,
  audience,
  onClick,
}: {
  notification: Notification;
  audience: NotificationAudience;
  onClick: (
    notification: Notification,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}) {
  const { d, relativeTime } = useI18n();
  const presentation = notificationPresentation(notification, d);
  const href = notificationHref(notification);

  return (
    <button
      type="button"
      onClick={(event) => onClick(notification, event)}
      className={cn(
        "relative flex w-full gap-3 px-4 py-3 text-left",
        "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-muted",
        !notification.isRead && "bg-brand-soft/25",
      )}
    >
      {!notification.isRead ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-brand"
        />
      ) : null}
      <span
        className={cn(
          "mt-1 size-1.5 shrink-0 rounded-full",
          notification.isRead ? "bg-transparent" : "bg-brand",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink">
            {presentation.title}
          </span>
          <span className="shrink-0 text-[11px] text-ink-subtle">
            {relativeTime(notification.createdAt)}
          </span>
        </span>
        <span className="mt-1 block truncate text-sm font-medium text-ink">
          {presentation.primary}
        </span>
        {presentation.secondary ? (
          <span
            className={cn(
              "mt-0.5 block truncate text-[13px] text-ink-muted",
              audience === "HR" && "font-medium text-ink-muted",
            )}
          >
            {presentation.secondary}
          </span>
        ) : null}
        {presentation.preview ? (
          <span className="mt-1 block overflow-hidden text-[12.5px] leading-relaxed text-ink-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
            {presentation.preview}
          </span>
        ) : null}
        {!href ? (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-ink-subtle">
            <AlertIcon className="size-3" />
            {d.notifications.noDestination}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** The heading for one time bucket. */
function bucketLabel(
  bucket: NotificationBucket,
  d: ReturnType<typeof useI18n>["d"],
): string {
  if (bucket === "today") return d.notifications.groupToday;
  if (bucket === "week") return d.notifications.groupWeek;
  return d.notifications.groupEarlier;
}
