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
import { CandidateAccountModule } from './candidate-account/candidate-account.module';
import { CandidateLinksModule } from './candidate-links/candidate-links.module';
import { WebIngestionModule } from './web-ingestion/web-ingestion.module';
import { PublicJobsModule } from './public-jobs/public-jobs.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { VacanciesModule } from './vacancies/vacancies.module';
import { CandidatesModule } from './candidates/candidates.module';
import { ApplicationsModule } from './applications/applications.module';
import { DocumentsModule } from './documents/documents.module';
import { EvidenceModule } from './evidence/evidence.module';
import { SearchModule } from './search/search.module';
import { EvidenceMapModule } from './evidence-map/evidence-map.module';
import { ProcessingModule } from './processing/processing.module';
import { QueueModule } from './queue/queue.module';
import { ChatModule } from './chat/chat.module';
import { IdentityModule } from './common/identity/identity.module';
import { EventsModule } from './common/events/events.module';
import { VacancyAccessModule } from './common/vacancy-access/vacancy-access.module';
import { NotificationsModule } from './notifications/notifications.module';

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
    StorageModule,
    AiModule,
    // Outbound fetching of candidate-supplied URLs, with the SSRF policy that
    // makes it safe. The only place the backend talks to the open internet.
    WebIngestionModule,

    // Feature modules
    HealthModule,
    AuthModule,
    CandidateAccountModule,
    CandidateLinksModule,
    PublicJobsModule,
    UsersModule,
    OrganizationsModule,
    VacanciesModule,
    CandidatesModule,
    ApplicationsModule,
    DocumentsModule,
    EvidenceModule,
    SearchModule,
    EvidenceMapModule,
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
