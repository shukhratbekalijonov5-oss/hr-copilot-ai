import type { NotificationResponse } from "@/lib/api/contracts";
import type { Notification } from "@/lib/types";

export type NotificationWire = NotificationResponse;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function toNotification(response: NotificationWire): Notification {
  return {
    id: response.id,
    type: response.type,
    audience: response.audience,
    isRead: response.isRead,
    createdAt: response.createdAt,
    vacancyId: optionalString(response.vacancyId ?? response.vacancy?.id),
    vacancyTitle: optionalString(
      response.vacancyTitle ?? response.vacancy?.title,
    ),
    candidateId: optionalString(response.candidateId ?? response.candidate?.id),
    candidateName: optionalString(
      response.candidateName ??
        response.candidate?.name ??
        response.candidate?.fullName,
    ),
    actorUserId: optionalString(response.actorUserId ?? response.actor?.id),
    actorName: optionalString(response.actorName ?? response.actor?.name),
    conversationId: optionalString(response.conversationId),
    messageId: optionalString(response.messageId),
    interviewId: optionalString(response.interviewId),
    applicationId: optionalString(response.applicationId),
    messagePreview: optionalString(response.messagePreview),
  };
}

export function parseNotification(value: unknown): Notification | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Partial<NotificationWire>;
  if (
    typeof response.id !== "string" ||
    typeof response.type !== "string" ||
    typeof response.audience !== "string" ||
    typeof response.isRead !== "boolean" ||
    typeof response.createdAt !== "string"
  ) {
    return null;
  }

  return toNotification(response as NotificationWire);
}
