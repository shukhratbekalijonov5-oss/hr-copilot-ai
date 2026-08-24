import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { FxRateService } from './fx-rate.service';
import { FxRateProvider, HttpFxRateProvider } from './fx-rate.provider';
import { FxRefreshProcessor } from './fx-refresh.processor';
import { FxRefreshScheduler } from './fx-refresh.scheduler';
import { FX_RATES_QUEUE } from './fx.constants';

/**
 * Shared exchange-rate infrastructure.
 *
 * Exported as a service, never as a network call: nothing above this module
 * makes an HTTP request for rates. A ranking run asks for the current snapshot
 * and gets whatever is cached, so a slow or failing provider can never slow
 * down or fail a candidate's job search.
 *
 * The same service is what a future external-job pipeline will use — there is
 * deliberately no per-provider currency handling anywhere in the product.
 */
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    BullModule.registerQueue({
      name: FX_RATES_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 24 * 3600, count: 100 },
        removeOnFail: { age: 7 * 24 * 3600, count: 200 },
      },
    }),
  ],
  providers: [
    { provide: FxRateProvider, useClass: HttpFxRateProvider },
    FxRateService,
    FxRefreshProcessor,
    FxRefreshScheduler,
  ],
  exports: [FxRateService],
})
export class FxModule {}
