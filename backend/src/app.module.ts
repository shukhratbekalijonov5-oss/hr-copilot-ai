import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';

import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { TenantModule } from './common/tenant/tenant.module';
import { StorageModule } from './storage/storage.module';
import { AiModule } from './ai/ai.module';

import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { VacanciesModule } from './vacancies/vacancies.module';
import { CandidatesModule } from './candidates/candidates.module';
import { ApplicationsModule } from './applications/applications.module';
import { DocumentsModule } from './documents/documents.module';
import { EvidenceModule } from './evidence/evidence.module';
import { ProcessingModule } from './processing/processing.module';
import { QueueModule } from './queue/queue.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
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
    StorageModule,
    AiModule,

    // Feature modules
    HealthModule,
    AuthModule,
    VacanciesModule,
    CandidatesModule,
    ApplicationsModule,
    DocumentsModule,
    EvidenceModule,
    ProcessingModule,
    QueueModule,
  ],
  providers: [
    // Order matters: authenticate, then check role, then rate limit.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
