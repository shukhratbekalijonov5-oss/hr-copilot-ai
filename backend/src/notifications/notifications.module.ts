import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationServiceClient } from './notification-service.client';
import { NotificationCreatedConsumer } from './notification-created.consumer';
import {
  InternalNotificationTokenGuard,
  NotificationUsersController,
} from './notification-users.controller';

/**
 * Notifications, with the Java Notification Service as the AUTHORITATIVE
 * store. This module is now three seams around that truth:
 *
 *  - PRODUCE: the listener turns committed business events into outbox rows;
 *    the outbox publisher ships them to Kafka (notifications.events.v1).
 *  - READ/MARK: the unchanged browser routes proxy the caller's own rows
 *    from the Java internal API through NotificationServiceClient.
 *  - REALTIME: the bridge consumer republishes Java's created-echo
 *    (notifications.created.v1) onto the EXISTING chat websocket.
 *
 * Plus the minimal internal user lookup the Java side calls at email-send
 * time, so email always reaches the CURRENT account address.
 */
@Module({
  controllers: [NotificationsController, NotificationUsersController],
  providers: [
    NotificationsService,
    NotificationsListener,
    NotificationOutboxService,
    NotificationServiceClient,
    NotificationCreatedConsumer,
    InternalNotificationTokenGuard,
  ],
  exports: [NotificationsService, NotificationOutboxService],
})
export class NotificationsModule {}
