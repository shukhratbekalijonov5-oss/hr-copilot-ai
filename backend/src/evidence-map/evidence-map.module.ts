import { Module } from '@nestjs/common';
import { EvidenceMapController } from './evidence-map.controller';
import { EvidenceMapService } from './evidence-map.service';

@Module({
  controllers: [EvidenceMapController],
  providers: [EvidenceMapService],
  exports: [EvidenceMapService],
})
export class EvidenceMapModule {}
