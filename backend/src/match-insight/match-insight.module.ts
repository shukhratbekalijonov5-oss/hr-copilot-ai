import { Module } from '@nestjs/common';
import { MatchInsightController } from './match-insight.controller';
import { MatchInsightService } from './match-insight.service';
import { CandidateEvidenceModule } from '../candidate-evidence/candidate-evidence.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [CandidateEvidenceModule, QueueModule],
  controllers: [MatchInsightController],
  providers: [MatchInsightService],
  exports: [MatchInsightService],
})
export class MatchInsightModule {}
