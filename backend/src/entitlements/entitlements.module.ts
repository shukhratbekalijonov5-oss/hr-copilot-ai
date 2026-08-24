import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CandidateEntitlementsService } from './candidate-entitlements.service';

/**
 * Candidate plan entitlements (FREE / PRO / MAX).
 *
 * @Global for the same reason the auth guards' dependencies are: the
 * enforcement guard is an APP_GUARD instantiated by the root module, and the
 * capability decorator may appear on any controller — every module would
 * otherwise import this one line.
 *
 * See candidate-plan.policy.ts for the product mapping and
 * candidate-entitlements.service.ts for the (transitional) plan source.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [CandidateEntitlementsService],
  exports: [CandidateEntitlementsService],
})
export class EntitlementsModule {}
