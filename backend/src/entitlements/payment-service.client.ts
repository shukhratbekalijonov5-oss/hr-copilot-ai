import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CANDIDATE_PLANS } from './candidate-plan.policy';
import type { CandidatePlan } from '../generated/prisma/enums';

/**
 * THE server-to-server client for the Java Payment Service — every HTTP call
 * the backend makes to :8081 goes through this one class. Three contracts:
 *
 *   GET  /internal/entitlements/{userId}   → entitlement truth (read)
 *   POST /internal/checkout                → provider checkout creation
 *   POST /internal/dev/plan-switch         → dev/test-profile plan switch
 *
 * All three authenticate with the same shared service credential
 * (`X-Internal-Token`), carry the same bounded timeout, and validate the
 * response SHAPE before anything downstream sees it. The token exists only
 * in this process's environment: it is never logged, never echoed, and no
 * response type below carries it.
 *
 * ## Fail closed, in every direction
 *
 * Timeout, connection refused, non-200, malformed JSON, a userId echo that
 * does not match, a plan outside FREE/PRO/MAX — every one of them returns
 * null (entitlements) or `{kind:'unavailable'}` (mutations), and the caller
 * maps that to FREE or a stable 503. An outage can cost a paying candidate
 * a premium feature for its duration; it can never grant one, and no
 * upstream error text ever travels toward a browser.
 *
 * ## The capability list is informational
 *
 * NestJS remains the enforcement boundary: capabilities are derived locally
 * from the plan via `candidate-plan.policy.ts`. The list in the response is
 * validated for shape, but enforcement never trusts a remote list over the
 * local table.
 */
export interface PaymentEntitlementsResponse {
  userId: string;
  plan: CandidatePlan;
  capabilities: string[];
  subscriptionStatus: string;
  effectiveUntil: string | null;
  version: number;
}

/**
 * Outcome of a payment-service MUTATION.
 *
 * 'rejected' means the service answered a definitive 4xx — retrying the
 * same request will not succeed. 'unavailable' means the truth could not
 * be reached or could not be trusted (transport failure, 5xx, malformed
 * body): the caller answers 503 and the client may retry later. Neither
 * variant carries upstream response text, by design.
 */
export type PaymentMutationOutcome<T> =
  ({ kind: 'ok' } & T) | { kind: 'rejected' } | { kind: 'unavailable' };

export interface CheckoutCreated {
  paymentId: string;
  checkoutId: string;
  redirectUrl: string;
  reused: boolean;
}

export interface PlanSwitched {
  plan: CandidatePlan;
  changed: boolean;
}

export interface CancelScheduled {
  cancelAtPeriodEnd: boolean;
}

export interface DowngradeScheduled {
  pendingPlan: CandidatePlan;
}

@Injectable()
export class PaymentServiceClient {
  private readonly logger = new Logger(PaymentServiceClient.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .get<string>('entitlements.paymentServiceUrl', '')
      .trim()
      .replace(/\/+$/, '');
    this.token = config
      .get<string>('entitlements.paymentServiceToken', '')
      .trim();
    this.timeoutMs = config.get<number>('entitlements.timeoutMs', 2_500);
  }

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  /** The user's entitlements, or null when the truth could not be read. */
  async entitlementsFor(
    userId: string,
  ): Promise<PaymentEntitlementsResponse | null> {
    const result = await this.request(
      `/internal/entitlements/${encodeURIComponent(userId)}`,
      { method: 'GET' },
      'entitlement lookup',
    );
    if (result.kind !== 'ok') return null;
    return this.validatedEntitlements(
      userId,
      result.body as Partial<PaymentEntitlementsResponse>,
    );
  }

  /**
   * Create (or idempotently re-serve) a provider checkout for one user.
   *
   * `idempotencyKey` is scoped per billing account by the Java side's
   * unique constraint — the same user retrying the same key gets the SAME
   * payment back; it cannot touch anyone else's checkout.
   */
  async createCheckout(
    userId: string,
    plan: CandidatePlan,
    idempotencyKey: string,
  ): Promise<PaymentMutationOutcome<CheckoutCreated>> {
    const result = await this.request(
      '/internal/checkout',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ userId, plan }),
      },
      'checkout creation',
    );
    if (result.kind !== 'ok') return result;

    const body = result.body as Partial<CheckoutCreated>;
    if (
      typeof body.paymentId !== 'string' ||
      typeof body.checkoutId !== 'string' ||
      typeof body.redirectUrl !== 'string'
    ) {
      this.logger.warn('Checkout response was malformed; treating as outage');
      return { kind: 'unavailable' };
    }
    return {
      kind: 'ok',
      paymentId: body.paymentId,
      checkoutId: body.checkoutId,
      redirectUrl: body.redirectUrl,
      reused: body.reused === true,
    };
  }

  /**
   * Switch a user's plan through the Java DEV/TEST-ONLY endpoint.
   *
   * In a production payment service that controller does not exist (Spring
   * `@Profile({"dev","test"})`) and this call answers 404 → 'rejected'; the
   * NestJS route that calls it is itself absent in production, so this is
   * the second lock, not the first.
   */
  async devSwitchPlan(
    userId: string,
    plan: CandidatePlan,
  ): Promise<PaymentMutationOutcome<PlanSwitched>> {
    const result = await this.request(
      '/internal/dev/plan-switch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, plan }),
      },
      'dev plan switch',
    );
    if (result.kind !== 'ok') return result;

    const body = result.body as { plan?: unknown; changed?: unknown };
    if (
      typeof body.plan !== 'string' ||
      !(CANDIDATE_PLANS as readonly string[]).includes(body.plan)
    ) {
      this.logger.warn(
        'Plan-switch response carried an unknown plan; treating as outage',
      );
      return { kind: 'unavailable' };
    }
    return {
      kind: 'ok',
      plan: body.plan as CandidatePlan,
      changed: body.changed === true,
    };
  }

  /**
   * Cancel the user's paid subscription AT PERIOD END. The Java side
   * validates there is an active paid subscription; entitlement stays
   * until `effectiveUntil`, then resolves to FREE. Never immediate, never
   * destructive.
   */
  async cancelSubscription(
    userId: string,
  ): Promise<PaymentMutationOutcome<CancelScheduled>> {
    const result = await this.request(
      `/internal/subscriptions/${encodeURIComponent(userId)}/cancel`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      'subscription cancel',
    );
    if (result.kind !== 'ok') return result;
    const body = result.body as { cancelAtPeriodEnd?: unknown };
    return { kind: 'ok', cancelAtPeriodEnd: body.cancelAtPeriodEnd === true };
  }

  /**
   * Schedule a downgrade to a LOWER PAID tier at period end. The Java side
   * enforces direction (a "downgrade" can never raise the plan or skip
   * payment) — this client just carries the intent.
   */
  async scheduleDowngrade(
    userId: string,
    plan: CandidatePlan,
  ): Promise<PaymentMutationOutcome<DowngradeScheduled>> {
    const result = await this.request(
      `/internal/subscriptions/${encodeURIComponent(userId)}/downgrade`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      },
      'subscription downgrade',
    );
    if (result.kind !== 'ok') return result;
    const body = result.body as { pendingPlan?: unknown };
    if (
      typeof body.pendingPlan !== 'string' ||
      !(CANDIDATE_PLANS as readonly string[]).includes(body.pendingPlan)
    ) {
      this.logger.warn(
        'Downgrade response carried an unknown plan; treating as outage',
      );
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', pendingPlan: body.pendingPlan as CandidatePlan };
  }

  /**
   * One transport core for every call: base-URL guard, service credential,
   * bounded timeout, JSON parse — and a hard rule that upstream response
   * TEXT never leaves this method. Only the status class does.
   */
  private async request(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    what: string,
  ): Promise<
    | { kind: 'ok'; body: unknown }
    | { kind: 'rejected' }
    | { kind: 'unavailable' }
  > {
    if (!this.configured) return { kind: 'unavailable' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: { ...(init.headers ?? {}), 'X-Internal-Token': this.token },
        body: init.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        // The upstream error BODY is deliberately not read: nothing it says
        // may ever reach a browser, so nothing it says is kept.
        this.logger.warn(
          `Payment service answered ${response.status} for a ${what}`,
        );
        return response.status >= 400 && response.status < 500
          ? { kind: 'rejected' }
          : { kind: 'unavailable' };
      }
      return { kind: 'ok', body: (await response.json()) as unknown };
    } catch (error) {
      // Timeout and transport errors land here. The error TYPE is logged;
      // the answer is "unknown", which callers read as FREE / 503.
      this.logger.warn(
        `Payment service ${what} failed: ${(error as Error).name || 'Error'}`,
      );
      return { kind: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  private validatedEntitlements(
    userId: string,
    body: Partial<PaymentEntitlementsResponse>,
  ): PaymentEntitlementsResponse | null {
    if (body.userId !== userId) {
      this.logger.warn('Entitlement response echoed a different userId');
      return null;
    }
    if (
      typeof body.plan !== 'string' ||
      !(CANDIDATE_PLANS as readonly string[]).includes(body.plan)
    ) {
      // A plan this deploy does not know grants NOTHING — fail closed, the
      // same rule the local policy table applies.
      this.logger.warn(
        'Entitlement response carried an unknown plan; failing closed',
      );
      return null;
    }
    if (!Array.isArray(body.capabilities)) {
      this.logger.warn('Entitlement response had no capability list');
      return null;
    }
    return {
      userId,
      plan: body.plan,
      capabilities: body.capabilities.filter(
        (value): value is string => typeof value === 'string',
      ),
      subscriptionStatus:
        typeof body.subscriptionStatus === 'string'
          ? body.subscriptionStatus
          : 'UNKNOWN',
      effectiveUntil:
        typeof body.effectiveUntil === 'string' ? body.effectiveUntil : null,
      version: typeof body.version === 'number' ? body.version : 0,
    };
  }
}
