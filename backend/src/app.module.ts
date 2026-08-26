import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';

import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { TenantModule } from './common/tenant/tenant.module';
import { MembershipModule } from './common/membership/membership.module';
import { StorageModule } from './storage/storage.module';
import { AiModule } from './ai/ai.module';

import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { CandidateAccountModule } from './candidate-account/candidate-account.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { PlanCapabilityGuard } from './entitlements/plan-capability.guard';
import { CandidatePreferencesModule } from './candidate-preferences/candidate-preferences.module';
import { ExternalJobsModule } from './external-jobs/external-jobs.module';
import { MetricsModule } from './metrics/metrics.module';
import { CandidateLinksModule } from './candidate-links/candidate-links.module';
import { WebIngestionModule } from './web-ingestion/web-ingestion.module';
import { PublicJobsModule } from './public-jobs/public-jobs.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { VacanciesModule } from './vacancies/vacancies.module';
import { CandidatesModule } from './candidates/candidates.module';
import { ApplicationsModule } from './applications/applications.module';
import { DocumentsModule } from './documents/documents.module';
import { SearchModule } from './search/search.module';
import { EvidenceMapModule } from './evidence-map/evidence-map.module';
import { MatchInsightModule } from './match-insight/match-insight.module';
import { ProcessingModule } from './processing/processing.module';
import { QueueModule } from './queue/queue.module';
import { ChatModule } from './chat/chat.module';
import { IdentityModule } from './common/identity/identity.module';
import { EventsModule } from './common/events/events.module';
import { VacancyAccessModule } from './common/vacancy-access/vacancy-access.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BillingModule } from './billing/billing.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { CandidateContextGuard } from './common/guards/candidate-context.guard';
import { OrgContextGuard } from './common/guards/org-context.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      // Fail fast and loudly on a bad environment, reporting names not values.
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.get<number>('throttle.ttlMs', 60_000),
          limit: config.get<number>('throttle.limit', 120),
        },
      ],
    }),

    // Infrastructure
    PrismaModule,
    RedisModule,
    TenantModule,
    MembershipModule,
    IdentityModule,
    EventsModule,
    VacancyAccessModule,
    NotificationsModule,
    BillingModule,
    StorageModule,
    AiModule,
    // Outbound fetching of candidate-supplied URLs, with the SSRF policy that
    // makes it safe. The only place the backend talks to the open internet.
    WebIngestionModule,

    // Feature modules
    HealthModule,
    AuthModule,
    AccountModule,
    CandidateAccountModule,
    EntitlementsModule,
    CandidatePreferencesModule,
    // External job ingestion. Registers no scheduler and calls no
    // provider yet: the pipeline exists so an implementation can plug in.
    ExternalJobsModule,
    MetricsModule,
    CandidateLinksModule,
    PublicJobsModule,
    UsersModule,
    OrganizationsModule,
    VacanciesModule,
    CandidatesModule,
    ApplicationsModule,
    DocumentsModule,
    SearchModule,
    EvidenceMapModule,
    MatchInsightModule,
    ProcessingModule,
    QueueModule,
    ChatModule,
  ],
  providers: [
    // Order matters: authenticate, then verify the account-type boundary of
    // whichever side the route belongs to (@CandidateScoped / @OrgScoped are
    // mutually exclusive on any route), then check role, then rate limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CandidateContextGuard },
    { provide: APP_GUARD, useClass: OrgContextGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Plan entitlements come AFTER identity/type/role: a recruiter on a
    // candidate surface is an account-type mismatch, never an upsell.
    { provide: APP_GUARD, useClass: PlanCapabilityGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
