import type { CandidatePlan } from '../generated/prisma/enums';

/**
 * WHERE a candidate's plan is read from — the seam the billing migration
 * turns on.
 *
 * Exactly two implementations exist, chosen once at boot by explicit
 * configuration (`ENTITLEMENTS_SOURCE`), never per request:
 *
 *   - `DbPlanSource` — the transitional `candidate_accounts.plan` column,
 *     today's behavior, kept as the explicit development adapter;
 *   - `PaymentServiceEntitlementsSource` — the Java Payment Service, the
 *     billing authority this seam was built for.
 *
 * Whatever the source, the CONSUMER side never changes: the guard, the
 * policy table, `/auth/me` and every gated route keep reading
 * `CandidateEntitlementsService`, and nothing a client sends — header,
 * body, token claim — can influence what any source answers.
 *
 * Every implementation must fail CLOSED: when the truth cannot be read, the
 * answer is FREE (grants nothing), never a guess and never "entitled".
 */
export interface EntitlementsSource {
  planFor(userId: string): Promise<CandidatePlan>;
  /**
   * Drop any cached answer for one user. Called when an
   * ENTITLEMENT_CHANGED event arrives (Kafka consumer — wired in a later
   * task) and safe to call on a source that caches nothing.
   */
  invalidate(userId: string): Promise<void>;
}

export const ENTITLEMENTS_SOURCE = Symbol('ENTITLEMENTS_SOURCE');
