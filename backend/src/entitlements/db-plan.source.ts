import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CandidatePlan } from '../generated/prisma/enums';
import type { EntitlementsSource } from './entitlements-source';

/**
 * The TRANSITIONAL plan source: the `candidate_accounts.plan` column.
 *
 * This is today's behavior, extracted verbatim so the seam could exist. The
 * column is server-side, defaulted to FREE, and written by no public API —
 * migrations, test fixtures and operators only — so it is not client-
 * influenceable; what makes it a development adapter is that it is not a
 * billing authority: nothing ever bills, renews or expires it.
 *
 * Production deployments are expected to select the Payment Service source;
 * booting production on this one logs a prominent warning (see the module
 * factory) rather than being silently normal.
 */
@Injectable()
export class DbPlanSource implements EntitlementsSource {
  constructor(private readonly prisma: PrismaService) {}

  async planFor(userId: string): Promise<CandidatePlan> {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { userId },
      select: { plan: true },
    });
    // No candidate account → FREE. A read ERROR, by contrast, propagates:
    // an outage must never hand out MAX, and must not pretend to know.
    return account?.plan ?? 'FREE';
  }

  async invalidate(): Promise<void> {
    // Nothing cached; nothing to do.
  }
}
