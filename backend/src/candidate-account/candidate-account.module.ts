import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';
import { CandidateAccountController } from './candidate-account.controller';
import { CandidateAccountService } from './candidate-account.service';
import { JobMatchRankingService } from './job-match-ranking.service';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { CandidateEvidenceModule } from '../candidate-evidence/candidate-evidence.module';
import { CandidatePreferencesModule } from '../candidate-preferences/candidate-preferences.module';
import { FxModule } from '../fx/fx.module';
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
    CandidateEvidenceModule,
    // Job Match reads the candidate's stated intent through the ONE shared
    // resolver rather than the preference tables. Read-only and non-scoring in
    // this task; the wire exists so Task 3 has nothing to re-plumb.
    CandidatePreferencesModule,
    // Exchange rates for cross-currency salary comparison. A shared service,
    // read once per ranking run — the ranking never makes a network call.
    FxModule,
  ],
  controllers: [CandidateAccountController],
  providers: [CandidateAccountService, JobMatchRankingService],
  exports: [CandidateAccountService, JobMatchRankingService],
})
export class CandidateAccountModule {}
