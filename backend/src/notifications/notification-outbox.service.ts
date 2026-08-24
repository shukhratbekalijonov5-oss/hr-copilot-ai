import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel, type Producer } from 'kafkajs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import {
  NOTIFICATION_EVENTS_TOPIC,
  NOTIFICATION_EVENT_VERSION,
  type NotificationEventContext,
  type OutboundNotificationEventType,
} from './notification-events';

/**
 * Builds the outbox row for one notification event. A pure data helper so a
 * caller that owns its own transaction (registration, a listener) can enlist
 * the row with `tx.notificationOutboxEvent.create({ data: ... })` without a
 * module dependency. The generated id IS the event id the Java service
 * dedupes on — created once here, stable across every publish retry.
 */
export function notificationOutboxRow(
  eventType: OutboundNotificationEventType,
  recipientUserId: string,
  context: NotificationEventContext,
): Prisma.NotificationOutboxEventCreateInput {
  return {
    id: randomUUID(),
    eventType,
    recipientUserId,
    payload: context as unknown as Prisma.InputJsonValue,
  };
}

/**
 * The reliability seam between committed business state and the Java
 * Notification Service (which is the notification TRUTH — nothing here
 * persists a user-visible notification anymore).
 *
 * `append` writes an outbox row — inside the caller's transaction when a tx
 * client is passed, so "business change happened" and "its notification
 * event exists" commit or roll back together. The publisher loop then ships
 * pending rows to Kafka with SKIP LOCKED batches (multi-instance safe) and
 * exponential backoff on failure; a Kafka outage delays notifications and
 * never loses them, and no user action ever waits on a broker.
 *
 * Without configured brokers the publisher stays off and rows accumulate —
 * visible, recoverable, and honest about the fact that nothing can deliver
 * them yet.
 */
@Injectable()
export class NotificationOutboxService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationOutboxService.name);
  private readonly brokers: string[];
  private readonly pollMs: number;
  private producer: Producer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private publishing = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.brokers = config
      .get<string>('notifications.kafkaBrokers', '')
      .split(',')
      .map((broker) => broker.trim())
      .filter((broker) => broker.length > 0);
    this.pollMs = config.get<number>('notifications.outboxPollMs', 500);
  }

  get enabled(): boolean {
    return this.brokers.length > 0;
  }

  /**
   * Append one notification event. Pass the surrounding Prisma transaction
   * client to make the row atomic with the business change; without one the
   * row commits on its own (listeners run after the business commit anyway).
   */
  async append(
    eventType: OutboundNotificationEventType,
    recipientUserId: string,
    context: NotificationEventContext,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.notificationOutboxEvent.create({
      data: notificationOutboxRow(eventType, recipientUserId, context),
    });
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'Notification outbox publisher off (no notification Kafka brokers)',
      );
      return;
    }
    // Background on purpose: an unreachable broker must not delay API boot.
    void this.start().catch((error: Error) => {
      this.logger.error(
        `Notification outbox publisher failed to start: ${error.message}`,
      );
    });
  }

  private async start(): Promise<void> {
    const kafka = new Kafka({
      clientId: 'hr-copilot-backend-notifications',
      brokers: this.brokers,
      logLevel: logLevel.ERROR,
      retry: { initialRetryTime: 300, retries: 5 },
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
    await this.producer.connect();
    this.timer = setInterval(() => {
      void this.publishPending();
    }, this.pollMs);
    this.logger.log(
      `Notification outbox publisher on (${NOTIFICATION_EVENTS_TOPIC}, every ${this.pollMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    try {
      await this.producer?.disconnect();
    } catch {
      // Shutdown noise only.
    }
  }

  /**
   * One publisher tick: lock a due batch with SKIP LOCKED (two backend
   * instances partition the backlog, nothing publishes twice from the
   * table), send each event, mark success per row, back off per failure.
   * Exposed for tests; the interval calls it with an overlap guard.
   */
  async publishPending(): Promise<void> {
    if (!this.producer || this.publishing) return;
    this.publishing = true;
    try {
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            eventType: string;
            recipientUserId: string;
            payload: unknown;
            createdAt: Date;
            attemptCount: number;
          }>
        >`
          SELECT "id", "eventType", "recipientUserId", "payload", "createdAt", "attemptCount"
          FROM "notification_outbox_events"
          WHERE "publishedAt" IS NULL
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
          ORDER BY "createdAt" ASC
          LIMIT 20
          FOR UPDATE SKIP LOCKED
        `;
        for (const row of rows) {
          try {
            await this.producer!.send({
              topic: NOTIFICATION_EVENTS_TOPIC,
              messages: [
                {
                  key: row.recipientUserId,
                  value: JSON.stringify({
                    eventId: row.id,
                    eventVersion: NOTIFICATION_EVENT_VERSION,
                    eventType: row.eventType,
                    occurredAt: row.createdAt.toISOString(),
                    recipientUserId: row.recipientUserId,
                    context: row.payload,
                  }),
                },
              ],
            });
            await tx.notificationOutboxEvent.update({
              where: { id: row.id },
              data: { publishedAt: new Date() },
            });
          } catch (error) {
            const attempts = row.attemptCount + 1;
            const delaySeconds = Math.min(
              300,
              5 * 2 ** Math.min(attempts - 1, 6),
            );
            await tx.notificationOutboxEvent.update({
              where: { id: row.id },
              data: {
                attemptCount: attempts,
                nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
                lastError: String((error as Error).message ?? 'unknown').slice(
                  0,
                  500,
                ),
              },
            });
            this.logger.warn(
              `Notification outbox publish failed for ${row.id} (attempt ${attempts})`,
            );
          }
        }
      });
    } catch (error) {
      this.logger.warn(
        `Notification outbox tick failed: ${(error as Error).message}`,
      );
    } finally {
      this.publishing = false;
    }
  }
}
