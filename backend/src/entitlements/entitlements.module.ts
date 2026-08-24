import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CandidateEntitlementsService } from './candidate-entitlements.service';
import { EntitlementEventsConsumer } from './entitlement-events.consumer';
import { PaymentServiceClient } from './payment-service.client';
import { PaymentServiceEntitlementsSource } from './payment-entitlements.source';
import { DbPlanSource } from './db-plan.source';
import { ENTITLEMENTS_SOURCE } from './entitlements-source';

/**
 * Candidate plan entitlements (FREE / PRO / MAX).
 *
 * @Global for the same reason the auth guards' dependencies are: the
 * enforcement guard is an APP_GUARD instantiated by the root module, and the
 * capability decorator may appear on any controller — every module would
 * otherwise import this one line.
 *
 * ## Source selection — explicit, at boot, from configuration
 *
 * `ENTITLEMENTS_SOURCE=payment-service` reads the Java Payment Service
 * (fail-closed client + short bounded cache). Anything else keeps the
 * transitional database column — today's behavior — and a PRODUCTION boot
 * on that source logs an error-level warning, because production plan truth
 * is meant to come from the billing authority, not a fixture column. The
 * selection is one environment variable read once; there is no per-request
 * switching and no client-influenced path.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    PaymentServiceClient,
    {
      provide: ENTITLEMENTS_SOURCE,
      inject: [
        ConfigService,
        PrismaService,
        RedisService,
        PaymentServiceClient,
      ],
      useFactory: (
        config: ConfigService,
        prisma: PrismaService,
        redis: RedisService,
        client: PaymentServiceClient,
      ) => {
        const logger = new Logger('EntitlementsModule');
        const source = config.get<string>('entitlements.source', 'db');
        if (source === 'payment-service') {
          logger.log('Entitlements source: Java Payment Service');
          return new PaymentServiceEntitlementsSource(client, redis, config);
        }
        if (process.env.NODE_ENV === 'production') {
          logger.error(
            'Entitlements source is the transitional DB column in a ' +
              'PRODUCTION environment. Plans are not billing-backed; set ' +
              'ENTITLEMENTS_SOURCE=payment-service once the Payment ' +
              'Service is deployed.',
          );
        } else {
          logger.log('Entitlements source: transitional DB column (dev)');
        }
        return new DbPlanSource(prisma);
      },
    },
    CandidateEntitlementsService,
    // Kafka ENTITLEMENT_CHANGED → invalidate(userId). Off without brokers
    // configured; safe against every source (DbPlanSource caches nothing).
    EntitlementEventsConsumer,
  ],
  exports: [
    CandidateEntitlementsService,
    ENTITLEMENTS_SOURCE,
    PaymentServiceClient,
  ],
})
export class EntitlementsModule {}
