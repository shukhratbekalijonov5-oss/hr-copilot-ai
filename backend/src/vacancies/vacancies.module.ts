import { Module } from '@nestjs/common';
import { VacanciesController } from './vacancies.controller';
import { VacanciesService } from './vacancies.service';
import { QueueModule } from '../queue/queue.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [QueueModule, ChatModule],
  controllers: [VacanciesController],
  providers: [VacanciesService],
  exports: [VacanciesService],
})
export class VacanciesModule {}
