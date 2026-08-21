import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { QueueModule } from '../queue/queue.module';
import { ProcessingModule } from '../processing/processing.module';

/**
 * No MulterModule: this module accepts no file. The only remaining upload
 * surface in the product is the candidate's own
 * /candidate-account/me/documents, which registers its own limits.
 */
@Module({
  imports: [QueueModule, ProcessingModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
