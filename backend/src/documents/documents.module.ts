import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DEFAULT_MAX_DOCUMENT_UPLOAD_BYTES } from './document-policy';
import { QueueModule } from '../queue/queue.module';
import { ProcessingModule } from '../processing/processing.module';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Files are held in memory only long enough to validate and forward
        // them to StorageService — nothing is written to a temp directory.
        storage: memoryStorage(),
        limits: {
          fileSize: config.get<number>(
            'storage.maxFileSizeBytes',
            DEFAULT_MAX_DOCUMENT_UPLOAD_BYTES,
          ),
          files: 1,
        },
      }),
    }),
    QueueModule,
    ProcessingModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
