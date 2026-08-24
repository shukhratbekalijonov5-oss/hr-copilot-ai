import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { DevEnvironmentGuard } from './dev-environment.guard';

/**
 * Candidate-facing billing BFF: summary read, checkout start, and the
 * dev/test-only plan switch. Depends only on what the global
 * EntitlementsModule already exports (the one PaymentServiceClient and the
 * ENTITLEMENTS_SOURCE seam) — billing talks to the Java service through
 * exactly the same client the entitlement reads use.
 */
@Module({
  controllers: [BillingController],
  providers: [BillingService, DevEnvironmentGuard],
})
export class BillingModule {}
