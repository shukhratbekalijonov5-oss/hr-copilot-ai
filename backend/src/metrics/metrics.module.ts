import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { ExternalJobsModule } from '../external-jobs/external-jobs.module';
import { EXTERNAL_JOBS_QUEUE } from '../external-jobs/external-jobs.constants';
import { MetricsService } from './metrics.service';

/**
 * Metrics are served on their OWN port (see `metrics.server.ts`), not as a
 * route on the public API — `api.hrcopilot.cloud/metrics` would publish
 * operational internals to the internet. There is deliberately no controller
 * in this module.
 */
@Module({
  imports: [
    PrismaModule,
    ExternalJobsModule,
    BullModule.registerQueue({ name: EXTERNAL_JOBS_QUEUE }),
  ],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
