import { Module } from '@nestjs/common';
import { PublicJobsController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';
import { CandidateAccountModule } from '../candidate-account/candidate-account.module';
import { ProcessingModule } from '../processing/processing.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [CandidateAccountModule, ProcessingModule, QueueModule],
  controllers: [PublicJobsController],
  providers: [PublicJobsService],
})
export class PublicJobsModule {}
