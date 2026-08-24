import { Module } from '@nestjs/common';
import { PublicJobsController } from './public-jobs.controller';
import { PublicJobsService } from './public-jobs.service';
import { CandidateAccountModule } from '../candidate-account/candidate-account.module';
import { FxModule } from '../fx/fx.module';

@Module({
  // Cross-currency salary filtering reads the shared rate snapshot; it never
  // makes a network call of its own.
  imports: [CandidateAccountModule, FxModule],
  controllers: [PublicJobsController],
  providers: [PublicJobsService],
})
export class PublicJobsModule {}
