import type { Dictionary } from "@/lib/i18n/dictionary";

/**
 * The notification API's one deliberate outage code.
 *
 * Notification rows moved behind the NestJS BFF to a service of their own.
 * When that service cannot be reached the BFF answers a stable 503 rather
 * than an empty page — an empty list would tell a reader their notifications
 * were deleted, which is a far worse lie than "temporarily unavailable".
 *
 * The frontend's job is to say that in the reader's language. The backend's
 * message is English prose written for an operator, so it is used only as the
 * last resort for failures nobody has classified.
 */
export const NOTIFICATIONS_UNAVAILABLE = "NOTIFICATIONS_UNAVAILABLE";

/** A failed `/api/notifications/*` call, carrying the code the BFF stated. */
export class NotificationRequestError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "NotificationRequestError";
    this.code = code;
  }
}

/**
 * What the bell shows for a failure. Localized copy wins wherever the failure
 * is one the product recognises; `fallback` covers everything else.
 */
export function notificationErrorText(
  caught: unknown,
  fallback: string,
  copy: Dictionary["notifications"]["errors"],
): string {
  if (
    caught instanceof NotificationRequestError &&
    caught.code === NOTIFICATIONS_UNAVAILABLE
  ) {
    return copy.unavailable;
  }
  return fallback;
}

/** Reads the `{ message, code }` body the notification route handlers answer with. */
export function toNotificationRequestError(
  payload: unknown,
  fallbackMessage: string,
): NotificationRequestError {
  if (!payload || typeof payload !== "object") {
    return new NotificationRequestError(fallbackMessage);
  }

  const body = payload as { message?: unknown; code?: unknown };
  return new NotificationRequestError(
    typeof body.message === "string" && body.message.length > 0
      ? body.message
      : fallbackMessage,
    typeof body.code === "string" ? body.code : null,
  );
}
