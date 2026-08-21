import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ChatModule } from '../chat/chat.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  // QueueModule: deleting an application must also evict the vectors of the
  // link snapshots that cascade away with it.
  imports: [ChatModule, QueueModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
