import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EXTERNAL_JOBS_QUEUE } from './external-jobs.constants';
import { ExternalIngestionService } from './external-ingestion.service';
import { ExternalSyncService } from './external-sync.service';
import { ExternalSyncScheduler } from './external-sync.scheduler';
import { ExternalJobsProcessor } from './external-jobs.processor';
import {
  EXTERNAL_JOB_PROVIDERS,
  ExternalProviderRegistry,
} from './provider-registry';
import { GreenhouseProvider } from './providers/greenhouse/greenhouse.provider';
import { LeverProvider } from './providers/lever/lever.provider';
import { AshbyProvider } from './providers/ashby/ashby.provider';
import { NinehireProvider } from './providers/ninehire/ninehire.provider';
import { CompanyCareersProvider } from './providers/company-careers/company-careers.provider';
import { WebIngestionModule } from '../web-ingestion/web-ingestion.module';
import { SafeHttpFetcher } from '../web-ingestion/safe-fetcher';
import { ExternalSearchController } from './search/external-search.controller';
import { ExternalSearchService } from './search/external-search.service';
import { ExternalJobDetailService } from './search/external-job-detail.service';
import { ExternalSearchRetrieval } from './search/external-search.retrieval';
import { ExternalIndexService } from './search/external-index.service';
import { CandidatePreferencesModule } from '../candidate-preferences/candidate-preferences.module';
import { SavedExternalJobsService } from './candidate/saved-external-jobs.service';
import { ExternalApplicationTrackingService } from './candidate/external-application-tracking.service';
import { CandidateExternalFlagsService } from './candidate/candidate-external-flags.service';
import { ExternalJobCardService } from './candidate/external-job-card.service';
import { ExternalApplicationsController } from './candidate/external-applications.controller';
import { ExternalPremiumAiContextService } from './premium-ai/external-premium-ai.context';
import { ExternalWhyMatchService } from './premium-ai/external-why-match.service';
import { PremiumAiCacheService } from './premium-ai/premium-ai.cache';
import { ExternalCoverLetterService } from './premium-ai/external-cover-letter.service';
import { ExternalInterviewPrepService } from './premium-ai/external-interview-prep.service';
import { ExternalMatchBreakdownService } from './premium-ai/external-match-breakdown.service';
import { FxModule } from '../fx/fx.module';
import { AiModule } from '../ai/ai.module';

/**
 * External job ingestion.
 *
 * Providers are constructed here and handed to the registry, which is the
 * single place the access boundary is enforced: the registry refuses a provider with
 * no host allowlist, and skips one that is not configured. A deployment with
 * no board tokens set therefore runs with zero external providers and makes no
 * network calls at all, rather than failing at the first scheduled sweep.
 *
 * Greenhouse, Lever, Ashby, Ninehire and the company careers reader sit here
 * as equals: one class and one entry each. Ninehire's authenticated
 * per-workspace access and the careers reader's robots-aware, SSRF-hardened
 * HTML fetching change how each of them FETCHES and nothing about how they are
 * registered or consumed. Nothing in matching, ranking, search or FX knows any
 * of their names — see `external-job-features.ts` for why that is structural
 * rather than a promise.
 *
 * The careers reader is the one provider that borrows another module's
 * fetcher: `SafeHttpFetcher` already resolves DNS, classifies every returned
 * address and pins the socket to the vetted one, which is what reading
 * arbitrary company websites needs and what four fixed ATS hosts never did.
 */
@Module({
  imports: [
    PrismaModule,
    WebIngestionModule,
    // The search side reuses the SHARED intent resolver, the SHARED FX
    // pipeline and the SHARED embedding service. None of them is re-implemented
    // here: a second seniority ladder or a second currency conversion is how
    // two surfaces start disagreeing about the same job.
    CandidatePreferencesModule,
    FxModule,
    AiModule,
    BullModule.registerQueue({
      name: EXTERNAL_JOBS_QUEUE,
      defaultJobOptions: {
        // Bounded retries with backoff. A provider that is down stays down for
        // minutes, and hammering it is both useless and the fastest way to
        // earn a permanent block.
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600, count: 1_000 },
      },
    }),
  ],
  controllers: [ExternalSearchController, ExternalApplicationsController],
  providers: [
    ExternalIngestionService,
    ExternalSearchService,
    ExternalJobDetailService,
    SavedExternalJobsService,
    ExternalApplicationTrackingService,
    CandidateExternalFlagsService,
    ExternalJobCardService,
    // The shared MAX premium-AI foundation. Task 4C.6 uses it for
    // "why this match"; Cover Letter / Interview Prep / Match Breakdown will
    // consume the same grounded context without touching search or ranking.
    ExternalPremiumAiContextService,
    PremiumAiCacheService,
    ExternalWhyMatchService,
    ExternalCoverLetterService,
    ExternalInterviewPrepService,
    ExternalMatchBreakdownService,
    ExternalSearchRetrieval,
    ExternalIndexService,
    ExternalProviderRegistry,
    ExternalSyncService,
    ExternalSyncScheduler,
    ExternalJobsProcessor,
    {
      provide: GreenhouseProvider,
      useFactory: (config: ConfigService) => new GreenhouseProvider(config),
      inject: [ConfigService],
    },
    {
      provide: LeverProvider,
      useFactory: (config: ConfigService) => new LeverProvider(config),
      inject: [ConfigService],
    },
    {
      provide: AshbyProvider,
      useFactory: (config: ConfigService) => new AshbyProvider(config),
      inject: [ConfigService],
    },
    {
      provide: NinehireProvider,
      useFactory: (config: ConfigService) => new NinehireProvider(config),
      inject: [ConfigService],
    },
    {
      // The one provider that takes a collaborator: reading arbitrary company
      // sites needs DNS classification and address pinning, which the
      // candidate-link fetcher already does and four fixed ATS hosts never
      // needed.
      provide: CompanyCareersProvider,
      useFactory: (config: ConfigService, fetcher: SafeHttpFetcher) =>
        new CompanyCareersProvider(config, fetcher),
      inject: [ConfigService, SafeHttpFetcher],
    },
    {
      // The registry registers whatever is in this array, at construction.
      // An unconfigured provider is skipped there, so a deployment that lists
      // no Lever sites simply runs without Lever.
      provide: EXTERNAL_JOB_PROVIDERS,
      useFactory: (
        greenhouse: GreenhouseProvider,
        lever: LeverProvider,
        ashby: AshbyProvider,
        ninehire: NinehireProvider,
        companyCareers: CompanyCareersProvider,
      ) => [greenhouse, lever, ashby, ninehire, companyCareers],
      inject: [
        GreenhouseProvider,
        LeverProvider,
        AshbyProvider,
        NinehireProvider,
        CompanyCareersProvider,
      ],
    },
  ],
  exports: [
    ExternalIngestionService,
    ExternalProviderRegistry,
    ExternalSyncService,
    ExternalSearchService,
    ExternalIndexService,
  ],
})
export class ExternalJobsModule {}
