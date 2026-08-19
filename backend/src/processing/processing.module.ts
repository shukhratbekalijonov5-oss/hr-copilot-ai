import { Module } from '@nestjs/common';
import { ProcessingService } from './processing.service';
import { ProcessingController } from './processing.controller';
import { InternalProcessingController } from './internal-processing.controller';
import { ProcessingGateway } from './processing.gateway';

@Module({
  controllers: [ProcessingController, InternalProcessingController],
  providers: [ProcessingService, ProcessingGateway],
  exports: [ProcessingService, ProcessingGateway],
})
export class ProcessingModule {}
