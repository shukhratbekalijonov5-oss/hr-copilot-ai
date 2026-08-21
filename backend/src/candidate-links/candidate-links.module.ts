import { Module } from '@nestjs/common';
import { CandidateLinksController } from './candidate-links.controller';
import { CandidateLinksService } from './candidate-links.service';
import { QueueModule } from '../queue/queue.module';
import { WebIngestionModule } from '../web-ingestion/web-ingestion.module';
import { CandidateEvidenceModule } from '../candidate-evidence/candidate-evidence.module';

@Module({
  imports: [QueueModule, WebIngestionModule, CandidateEvidenceModule],
  controllers: [CandidateLinksController],
  providers: [CandidateLinksService],
  exports: [CandidateLinksService],
})
export class CandidateLinksModule {}
