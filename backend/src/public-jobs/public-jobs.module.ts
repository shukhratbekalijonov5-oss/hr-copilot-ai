import { Module } from '@nestjs/common';
import { PublicJobsController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';
import { CandidateAccountModule } from '../candidate-account/candidate-account.module';

@Module({
  imports: [CandidateAccountModule],
  controllers: [PublicJobsController],
  providers: [PublicJobsService],
})
export class PublicJobsModule {}
