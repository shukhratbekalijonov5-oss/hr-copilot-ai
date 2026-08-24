import { ApiError } from "@/lib/api/errors";

/**
 * The failure body every `/api/notifications/*` route handler answers with.
 *
 * `code` is forwarded from the API untouched so the browser can recognise a
 * classified failure — an unreachable notification service, above all — and
 * render its own localized copy instead of the backend's English text. No
 * other part of the upstream error crosses: no status text, no stack, no
 * upstream URL.
 */
export interface NotificationErrorBody {
  message: string;
  code?: string;
}

export function notificationFailure(
  error: unknown,
  fallback: string,
): { body: NotificationErrorBody; status: number } {
  const status = error instanceof ApiError ? error.status || 500 : 500;
  const code = error instanceof ApiError ? error.code : null;

  return {
    status,
    body: {
      message: error instanceof Error ? error.message : fallback,
      ...(code ? { code } : {}),
    },
  };
}
