import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DomainEventsService,
  type DomainEventMap,
} from '../common/events/domain-events.service';
import { NotificationOutboxService } from './notification-outbox.service';
import { toMessagePreview } from './notification-view';
import {
  ApplicationStatus,
  ConversationParty,
  NotificationAudience,
  NotificationType,
} from '../generated/prisma/enums';

/**
 * Turns committed business events into notification EVENTS.
 *
 * Persistence moved to the Java Notification Service: each handler resolves
 * the recipient exactly as before, then appends one outbox row per
 * (notification, recipient) — the outbox → Kafka → Java pipeline persists
 * the row and echoes it back for realtime. Recipient rules, transition
 * gating and snapshot capture are UNCHANGED.
 *
 * The single place recipient resolution happens, and it only ever reads
 * TRUSTED relationships from the database — vacancy.createdById for HR,
 * candidateAccount.userId for candidates. No event payload names a recipient
 * directly except `vacancy.deleted`, whose recipient set was itself resolved
 * from the applications table before deletion (the rows are gone when the
 * event fires).
 *
 * Rules encoded here:
 *  - HR is notified ONLY as the vacancy's creator — never the whole org.
 *  - Nobody is notified about their own action (sender/actor self-noise).
 *  - Transition-gated events (invite, reject) notify only on a GENUINE
 *    transition; re-saves are silent.
 *
 * Every handler runs after the publisher's transaction committed (the
 * project-wide events convention), so no notification can describe a
 * rolled-back change. Handlers are best-effort: a failure here is logged by
 * the bus and never breaks the business operation that emitted the event.
 */
@Injectable()
export class NotificationsListener implements OnModuleInit {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
    private readonly outbox: NotificationOutboxService,
  ) {}

  onModuleInit(): void {
    this.events.on('application.created', (e) => this.onApplicationCreated(e));
    this.events.on('chat.message.created', (e) => this.onMessageCreated(e));
    this.events.on('interview.invited', (e) => this.onInterviewInvited(e));
    this.events.on('application.rejected', (e) =>
      this.onApplicationRejected(e),
    );
    this.events.on('vacancy.deleted', (e) => this.onVacancyDeleted(e));
  }

  /** HR ← a candidate applied to one of their vacancies. */
  private async onApplicationCreated(
    event: DomainEventMap['application.created'],
  ): Promise<void> {
    const [vacancy, candidate] = await Promise.all([
      this.prisma.vacancy.findUnique({
        where: { id: event.vacancyId },
        select: { createdById: true, title: true },
      }),
      this.prisma.candidate.findUnique({
        where: { id: event.candidateId },
        select: { fullName: true },
      }),
    ]);
    // The vacancy was deleted between commit and handling — nothing to say.
    if (!vacancy || !candidate) return;

    await this.outbox.append(
      NotificationType.NEW_APPLICATION,
      vacancy.createdById,
      {
        audience: NotificationAudience.HR,
        organizationId: event.organizationId,
        vacancyId: event.vacancyId,
        vacancyTitle: vacancy.title,
        candidateId: event.candidateId,
        candidateName: candidate.fullName,
        applicationId: event.applicationId,
      },
    );
  }

  /**
   * Chat message → the OTHER side of the conversation, never the sender.
   * Candidate → HR lands with the vacancy's creator (the only HR who can see
   * the conversation under the creator-scoped chat model); HR → candidate
   * lands with the conversation's candidate account owner.
   */
  private async onMessageCreated(
    event: DomainEventMap['chat.message.created'],
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: event.conversationId },
      select: {
        organizationId: true,
        vacancy: { select: { id: true, title: true, createdById: true } },
        candidate: { select: { id: true, fullName: true } },
        candidateAccount: { select: { userId: true } },
      },
    });
    // Deleted between send and handling (vacancy closed mid-flight).
    if (!conversation) return;

    const preview = toMessagePreview(event.message.content);
    if (event.message.senderParty === ConversationParty.CANDIDATE) {
      const recipient = conversation.vacancy.createdById;
      if (recipient === event.senderUserId) return; // impossible, but never self-notify
      await this.outbox.append(NotificationType.NEW_MESSAGE, recipient, {
        audience: NotificationAudience.HR,
        organizationId: conversation.organizationId,
        vacancyId: conversation.vacancy.id,
        vacancyTitle: conversation.vacancy.title,
        candidateId: conversation.candidate.id,
        candidateName: conversation.candidate.fullName,
        actorUserId: event.senderUserId,
        actorName: event.message.senderName,
        conversationId: event.conversationId,
        messageId: event.message.id,
        messagePreview: preview,
      });
      return;
    }

    const recipient = conversation.candidateAccount.userId;
    if (recipient === event.senderUserId) return;
    await this.outbox.append(NotificationType.NEW_MESSAGE, recipient, {
      // Personal data: no organizationId, like everything candidate-owned.
      audience: NotificationAudience.CANDIDATE,
      vacancyId: conversation.vacancy.id,
      vacancyTitle: conversation.vacancy.title,
      candidateId: conversation.candidate.id,
      candidateName: conversation.candidate.fullName,
      actorUserId: event.senderUserId,
      actorName: event.message.senderName,
      conversationId: event.conversationId,
      messageId: event.message.id,
      messagePreview: preview,
    });
  }

  /** Candidate ← invited to interview (genuine transition only). */
  private async onInterviewInvited(
    event: DomainEventMap['interview.invited'],
  ): Promise<void> {
    // Re-invites are idempotent business-side and silent notification-side.
    if (event.previousStatus === ApplicationStatus.INTERVIEW) return;

    const [account, vacancy, candidate, actor] = await Promise.all([
      this.prisma.candidateAccount.findUnique({
        where: { id: event.candidateAccountId },
        select: { userId: true },
      }),
      this.prisma.vacancy.findUnique({
        where: { id: event.vacancyId },
        select: { title: true },
      }),
      this.prisma.candidate.findUnique({
        where: { id: event.candidateId },
        select: { fullName: true },
      }),
      this.prisma.user.findUnique({
        where: { id: event.actorUserId },
        select: { fullName: true },
      }),
    ]);
    if (!account || !vacancy) return;

    await this.outbox.append(
      NotificationType.INTERVIEW_INVITATION,
      account.userId,
      {
        audience: NotificationAudience.CANDIDATE,
        vacancyId: event.vacancyId,
        vacancyTitle: vacancy.title,
        candidateId: event.candidateId,
        candidateName: candidate?.fullName ?? null,
        actorUserId: event.actorUserId,
        actorName: actor?.fullName ?? null,
        applicationId: event.applicationId,
        conversationId: event.conversationId,
      },
    );
  }

  /** Candidate ← their application was rejected (genuine transition only). */
  private async onApplicationRejected(
    event: DomainEventMap['application.rejected'],
  ): Promise<void> {
    // REJECTED → REJECTED re-saves are not a transition.
    if (event.previousStatus === ApplicationStatus.REJECTED) return;

    const [account, vacancy] = await Promise.all([
      this.prisma.candidateAccount.findUnique({
        where: { id: event.candidateAccountId },
        select: { userId: true },
      }),
      this.prisma.vacancy.findUnique({
        where: { id: event.vacancyId },
        select: { title: true },
      }),
    ]);
    if (!account || !vacancy) return;

    await this.outbox.append(
      NotificationType.APPLICATION_REJECTED,
      account.userId,
      {
        audience: NotificationAudience.CANDIDATE,
        vacancyId: event.vacancyId,
        vacancyTitle: vacancy.title,
        candidateId: event.candidateId,
        applicationId: event.applicationId,
      },
    );
  }

  /**
   * Candidates ← a vacancy they applied to was deleted. The recipient set and
   * the title were captured BEFORE deletion (the event fires after commit,
   * when the rows are gone) — this is why the snapshot fields exist. One
   * notification per (recipient, vacancy): a bulk delete of two vacancies a
   * candidate applied to yields two distinct, unambiguous notifications.
   */
  private async onVacancyDeleted(
    event: DomainEventMap['vacancy.deleted'],
  ): Promise<void> {
    for (const recipient of event.recipients) {
      // The deleting HR could theoretically be an applicant via a second
      // (candidate) identity — impossible under account exclusivity, but the
      // self-noise rule costs nothing to keep uniform.
      if (recipient.userId === event.actorUserId) continue;
      await this.outbox.append(
        NotificationType.VACANCY_DELETED,
        recipient.userId,
        {
          audience: NotificationAudience.CANDIDATE,
          vacancyId: event.vacancyId,
          vacancyTitle: event.vacancyTitle,
          candidateId: recipient.candidateId,
        },
      );
    }
    if (event.recipients.length > 0) {
      this.logger.log(
        `Vacancy ${event.vacancyId} deletion notified ${event.recipients.length} applicant(s)`,
      );
    }
  }
}
