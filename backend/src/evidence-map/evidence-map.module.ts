import { Module } from '@nestjs/common';
import { EvidenceMapController } from './evidence-map.controller';
import { EvidenceMapService } from './evidence-map.service';
import { CandidateEvidenceModule } from '../candidate-evidence/candidate-evidence.module';

@Module({
  imports: [CandidateEvidenceModule],
  controllers: [EvidenceMapController],
  providers: [EvidenceMapService],
  exports: [EvidenceMapService],
})
export class EvidenceMapModule {}
