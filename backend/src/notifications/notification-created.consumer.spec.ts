import { ConfigService } from '@nestjs/config';
import { NotificationCreatedConsumer } from './notification-created.consumer';
import type { DomainEventsService } from '../common/events/domain-events.service';

/**
 * The realtime bridge's decision table: only a well-formed
 * NOTIFICATION_CREATED envelope reaches the websocket; everything else is
 * acknowledged without effect (a poison message must never wedge the
 * partition, and this path holds no state to corrupt).
 */

function consumerWith(events: { publish: jest.Mock }) {
  const config = {
    get: (key: string, fallback: unknown) =>
      key === 'notifications.kafkaBrokers' ? 'localhost:9092' : fallback,
  } as unknown as ConfigService;
  return new NotificationCreatedConsumer(
    events as unknown as DomainEventsService,
    config,
  );
}

const envelope = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    eventId: 'evt-1',
    eventVersion: 1,
    eventType: 'NOTIFICATION_CREATED',
    occurredAt: '2026-08-25T10:00:00Z',
    recipientUserId: 'user-1',
    notification: {
      id: 'n1',
      type: 'SUBSCRIPTION_ACTIVATED',
      audience: 'CANDIDATE',
      organizationId: null,
      isRead: false,
      readAt: null,
      createdAt: '2026-08-25T10:00:00Z',
      vacancyId: null,
      vacancyTitle: null,
      candidateId: null,
      candidateName: null,
      actorName: null,
      applicationId: null,
      conversationId: null,
      messageId: null,
      messagePreview: null,
    },
    ...over,
  });

describe('handleMessage', () => {
  it('republishes a valid created-event onto the in-process bus for the gateway', () => {
    const events = { publish: jest.fn() };
    const outcome = consumerWith(events).handleMessage(envelope());
    expect(outcome).toBe('published');
    expect(events.publish).toHaveBeenCalledWith(
      'notification.created',
      expect.objectContaining({
        recipientUserId: 'user-1',
        notification: expect.objectContaining({
          id: 'n1',
          type: 'SUBSCRIPTION_ACTIVATED',
        }),
      }),
    );
  });

  it('malformed payloads are acknowledged without effect', () => {
    const events = { publish: jest.fn() };
    const consumer = consumerWith(events);
    expect(consumer.handleMessage(null)).toBe('malformed');
    expect(consumer.handleMessage('not-json')).toBe('malformed');
    expect(consumer.handleMessage('"just a string"')).toBe('malformed');
    expect(consumer.handleMessage(envelope({ recipientUserId: '' }))).toBe(
      'malformed',
    );
    expect(consumer.handleMessage(envelope({ notification: null }))).toBe(
      'malformed',
    );
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('foreign event types on the topic are ignored', () => {
    const events = { publish: jest.fn() };
    expect(
      consumerWith(events).handleMessage(
        envelope({ eventType: 'SOMETHING_ELSE' }),
      ),
    ).toBe('ignored');
    expect(events.publish).not.toHaveBeenCalled();
  });
});
