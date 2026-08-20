import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';
import { CandidateAccountController } from './candidate-account.controller';
import { CandidateAccountService } from './candidate-account.service';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { DEFAULT_MAX_DOCUMENT_UPLOAD_BYTES } from '../documents/document-policy';

@Module({
  imports: [
    // Same limits as the recruiter upload path. Without this registration
    // Multer would buffer an arbitrarily large body into memory before the
    // service-level validator ever saw it.
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
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
    StorageModule,
    QueueModule,
  ],
  controllers: [CandidateAccountController],
  providers: [CandidateAccountService],
  exports: [CandidateAccountService],
})
export class CandidateAccountModule {}
