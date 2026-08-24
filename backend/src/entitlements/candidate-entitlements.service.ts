import { Inject, Injectable } from '@nestjs/common';
import type { CandidatePlan } from '../generated/prisma/enums';
import {
  grantedCapabilities,
  hasCapability,
  type CandidateCapability,
} from './candidate-plan.policy';
import { ENTITLEMENTS_SOURCE } from './entitlements-source';
import type { EntitlementsSource } from './entitlements-source';

export interface CandidateEntitlements {
  plan: CandidatePlan;
  capabilities: CandidateCapability[];
}

/**
 * WHERE a candidate's plan comes from — now an explicit seam.
 *
 * ## The source is configuration, the contract is not
 *
 * `ENTITLEMENTS_SOURCE` selects, once at boot, between the transitional
 * database column (`DbPlanSource` — today's behavior, the development
 * adapter) and the Java Payment Service
 * (`PaymentServiceEntitlementsSource` — the billing authority, with a
 * short bounded cache). See entitlements.module.ts for the selection and
 * the production warning.
 *
 * Nothing downstream changed: the guard, the policy table, the error
 * contract and every gated route consume THIS service and never know the
 * storage. And in every configuration, nothing a candidate sends — body,
 * query, cookie, header, token claim — can change what this service
 * answers.
 *
 * ## Fail-closed
 *
 * No account / no subscription / unreadable remote truth → FREE, which
 * grants nothing. No error path defaults to entitled.
 */
@Injectable()
export class CandidateEntitlementsService {
  constructor(
    @Inject(ENTITLEMENTS_SOURCE) private readonly source: EntitlementsSource,
  ) {}

  /** The caller's current plan, resolved live — never from a token claim. */
  async planFor(userId: string): Promise<CandidatePlan> {
    return this.source.planFor(userId);
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
