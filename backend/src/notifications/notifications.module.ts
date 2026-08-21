import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';

/**
 * Persistent, realtime-delivered notifications for both product sides.
 *
 * Depends only on the global Prisma/Events modules; realtime delivery rides
 * the EXISTING chat websocket (ChatGateway subscribes to
 * `notification.created` and emits into the recipient's `user:{id}` room) —
 * no second realtime stack, no BullMQ hop for a single row insert.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
