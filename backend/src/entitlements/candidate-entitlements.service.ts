import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CandidatePlan } from '../generated/prisma/enums';
import {
  grantedCapabilities,
  hasCapability,
  type CandidateCapability,
} from './candidate-plan.policy';

export interface CandidateEntitlements {
  plan: CandidatePlan;
  capabilities: CandidateCapability[];
}

/**
 * WHERE a candidate's plan comes from — the single seam for the future
 * billing authority.
 *
 * ## Transitional, by design
 *
 * Today the plan is the `candidate_accounts.plan` column: server-side,
 * defaulted to FREE, written by no public API (migrations, test fixtures and
 * operators only), so nothing a candidate sends — body, query, cookie,
 * header, token claim — can change what this service answers.
 *
 * When the Java Payment Service exists it becomes the subscription
 * authority, and `planFor` swaps its read to that service (with whatever
 * caching the latency budget needs). That is the ENTIRE migration: the
 * guard, the policy table, the error contract and every gated route consume
 * this service and never know the storage.
 *
 * ## Fail-closed
 *
 * No candidate account → FREE. A read error propagates rather than
 * defaulting to entitled: an outage must never hand out MAX.
 */
@Injectable()
export class CandidateEntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's current plan, resolved live — never from a token claim. */
  async planFor(userId: string): Promise<CandidatePlan> {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { userId },
      select: { plan: true },
    });
    return account?.plan ?? 'FREE';
  }

  async can(userId: string, capability: CandidateCapability): Promise<boolean> {
    return hasCapability(await this.planFor(userId), capability);
  }

  /**
   * The read contract `/auth/me` publishes: the plan plus everything it
   * grants, resolved through the SAME policy table the guard enforces with.
   * The UI locks features from this before any 403; the guard remains the
   * final authority regardless of what any client believes.
   */
  async entitlementsFor(userId: string): Promise<CandidateEntitlements> {
    const plan = await this.planFor(userId);
    return { plan, capabilities: grantedCapabilities(plan) };
  }
}
