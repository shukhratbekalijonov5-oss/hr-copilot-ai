import type { Notification } from "@/lib/types";

function withQuery(path: string, query: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function notificationHref(notification: Notification): string | null {
  if (notification.audience === "HR") {
    if (
      notification.type === "NEW_APPLICATION" &&
      notification.candidateId
    ) {
      return withQuery(`/candidates/${notification.candidateId}`, {
        vacancyId: notification.vacancyId,
      });
    }

    if (
      notification.type === "NEW_MESSAGE" &&
      notification.conversationId
    ) {
      return withQuery("/interview-chats", {
        conversation: notification.conversationId,
        vacancyId: notification.vacancyId,
      });
    }

    return null;
  }

  if (
    (notification.type === "NEW_MESSAGE" ||
      notification.type === "INTERVIEW_INVITATION") &&
    notification.conversationId
  ) {
    return withQuery("/my-interview-chats", {
      conversation: notification.conversationId,
    });
  }

  if (
    notification.type === "VACANCY_DELETED" ||
    notification.type === "APPLICATION_REJECTED"
  ) {
    return "/my-applications";
  }

  return null;
}
