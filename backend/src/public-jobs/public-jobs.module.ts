import { Module } from '@nestjs/common';
import { PublicJobsController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';
import { CandidateAccountModule } from '../candidate-account/candidate-account.module';
import { CandidateLinksModule } from '../candidate-links/candidate-links.module';
import { ProcessingModule } from '../processing/processing.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    CandidateAccountModule,
    // Apply snapshots the candidate's COMPLETED links; the rule for which
    // links may be submitted lives with the links, not here.
    CandidateLinksModule,
    ProcessingModule,
    QueueModule,
  ],
  controllers: [PublicJobsController],
  providers: [PublicJobsService],
})
export class PublicJobsModule {}
