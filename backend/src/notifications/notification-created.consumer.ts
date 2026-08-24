import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, logLevel } from 'kafkajs';
import { DomainEventsService } from '../common/events/domain-events.service';
import { NOTIFICATION_CREATED_TOPIC } from './notification-events';
import { toView } from './notifications.service';
import type { JavaNotificationRow } from './notification-service.client';

/**
 * The realtime bridge: when the Java Notification Service persists a
 * notification — whatever caused it (a backend business event, a payment
 * activation, the expiry scheduler) — it announces the row on
 * `notifications.created.v1`, and this consumer republishes it as the
 * in-process `notification.created` event the EXISTING websocket gateway
 * already fans out to the recipient's personal room. One realtime path for
 * every origin; the browser contract does not change.
 *
 * ## Safety
 *
 * The only effect is a websocket emit of an already-persisted row — no
 * state, no authorization decision. A malformed message is logged and
 * acknowledged (a poison message must not wedge the partition); a duplicate
 * delivery costs one redundant UI event that renders identically (same id).
 * Off unless notification Kafka brokers are configured.
 */
@Injectable()
export class NotificationCreatedConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationCreatedConsumer.name);
  private readonly brokers: string[];
  private readonly groupId: string;
  private consumer: Consumer | null = null;

  constructor(
    private readonly events: DomainEventsService,
    config: ConfigService,
  ) {
    this.brokers = config
      .get<string>('notifications.kafkaBrokers', '')
      .split(',')
      .map((broker) => broker.trim())
      .filter((broker) => broker.length > 0);
    this.groupId = config.get<string>(
      'notifications.kafkaConsumerGroup',
      'hr-copilot-backend.notification-bridge',
    );
  }

  get enabled(): boolean {
    return this.brokers.length > 0;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Notification realtime bridge off (no brokers)');
      return;
    }
    void this.start().catch((error: Error) => {
      this.logger.error(
        `Notification realtime bridge failed to start: ${error.message}`,
      );
    });
  }

  private async start(): Promise<void> {
    const kafka = new Kafka({
      clientId: 'hr-copilot-backend-notification-bridge',
      brokers: this.brokers,
      logLevel: logLevel.ERROR,
      retry: { initialRetryTime: 300, retries: 8 },
    });
    this.consumer = kafka.consumer({ groupId: this.groupId });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: NOTIFICATION_CREATED_TOPIC,
      fromBeginning: false,
    });
    await this.consumer.run({
      eachMessage: ({ message }) => {
        this.handleMessage(message.value?.toString('utf8') ?? null);
        return Promise.resolve();
      },
    });
    this.logger.log(
      `Bridging ${NOTIFICATION_CREATED_TOPIC} to the websocket gateway`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.consumer?.disconnect();
    } catch {
      // Shutdown noise only.
    }
  }

  /** Transport-free decision core, unit-testable without a broker. */
  handleMessage(raw: string | null): 'published' | 'malformed' | 'ignored' {
    if (!raw || raw.trim().length === 0) return 'malformed';
    let envelope: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return 'malformed';
      envelope = parsed as Record<string, unknown>;
    } catch {
      this.logger.error('notification-created event was not valid JSON');
      return 'malformed';
    }
    if (envelope.eventType !== 'NOTIFICATION_CREATED') return 'ignored';
    const recipientUserId =
      typeof envelope.recipientUserId === 'string'
        ? envelope.recipientUserId
        : '';
    const notification = envelope.notification;
    if (
      recipientUserId.length === 0 ||
      typeof notification !== 'object' ||
      notification === null ||
      typeof (notification as { id?: unknown }).id !== 'string'
    ) {
      this.logger.error('notification-created event missing recipient or row');
      return 'malformed';
    }
    this.events.publish('notification.created', {
      recipientUserId,
      notification: toView(notification as JavaNotificationRow),
    });
    return 'published';
  }
}
