import type { Dictionary } from "@/lib/i18n/dictionary";
import { format } from "@/lib/i18n/format";
import type { Notification, NotificationAudience } from "@/lib/types";

export interface NotificationPresentation {
  title: string;
  primary: string;
  secondary: string | null;
  preview: string | null;
}

export function notificationPresentation(
  notification: Notification,
  d: Dictionary,
): NotificationPresentation {
  const strings = d.notifications;
  const vacancy =
    notification.vacancyTitle ?? strings.fallbacks.vacancyUnavailable;
  const candidate =
    notification.candidateName ?? strings.fallbacks.candidateUnavailable;
  const actor = notification.actorName ?? strings.fallbacks.recruiter;
  const messagePreview =
    notification.messagePreview ?? strings.messages.newMessageFallback;

  switch (notification.type) {
    case "NEW_APPLICATION":
      return {
        title: strings.types.NEW_APPLICATION,
        primary: candidate,
        secondary: vacancy,
        preview: null,
      };
    case "NEW_MESSAGE":
      return {
        title: strings.types.NEW_MESSAGE,
        primary: notification.audience === "HR" ? candidate : actor,
        secondary: vacancy,
        preview: messagePreview,
      };
    case "INTERVIEW_INVITATION":
      return {
        title: strings.types.INTERVIEW_INVITATION,
        primary: actor,
        secondary: vacancy,
        preview: strings.messages.interviewInvitation,
      };
    case "VACANCY_DELETED":
      return {
        title: strings.types.VACANCY_DELETED,
        primary: vacancy,
        secondary: null,
        preview: format(strings.messages.vacancyDeleted, { vacancy }),
      };
    case "APPLICATION_REJECTED":
      return {
        title: strings.types.APPLICATION_REJECTED,
        primary: vacancy,
        secondary: null,
        preview: strings.messages.applicationRejected,
      };
  }
}

export function emptyNotificationText(
  audience: NotificationAudience,
  d: Dictionary,
): { title: string; description: string } {
  return audience === "HR"
    ? {
        title: d.notifications.empty.hrTitle,
        description: d.notifications.empty.hrDescription,
      }
    : {
        title: d.notifications.empty.candidateTitle,
        description: d.notifications.empty.candidateDescription,
      };
}
