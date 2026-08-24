import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PaymentServiceClient,
  type CheckoutCreated,
} from '../entitlements/payment-service.client';
import { ENTITLEMENTS_SOURCE } from '../entitlements/entitlements-source';
import type { EntitlementsSource } from '../entitlements/entitlements-source';
import { grantedCapabilities } from '../entitlements/candidate-plan.policy';
import type { CandidatePlan } from '../generated/prisma/enums';

/** Stable browser-facing error codes. Never carry upstream text. */
export const BILLING_UNAVAILABLE = 'BILLING_UNAVAILABLE';
export const CHECKOUT_UNAVAILABLE = 'CHECKOUT_UNAVAILABLE';
export const PLAN_NOT_PURCHASABLE = 'PLAN_NOT_PURCHASABLE';
export const INVALID_IDEMPOTENCY_KEY = 'INVALID_IDEMPOTENCY_KEY';
export const PLAN_SWITCH_UNAVAILABLE = 'PLAN_SWITCH_UNAVAILABLE';
export const NOTHING_TO_CANCEL = 'NOTHING_TO_CANCEL';
export const CANCEL_UNAVAILABLE = 'CANCEL_UNAVAILABLE';
export const DOWNGRADE_NOT_ALLOWED = 'DOWNGRADE_NOT_ALLOWED';
export const DOWNGRADE_UNAVAILABLE = 'DOWNGRADE_UNAVAILABLE';

/**
 * A caller-supplied idempotency key: long enough to be an honest retry
 * token, short and clean enough to travel as a header and land in a
 * VARCHAR(100) unique constraint.
 */
const IDEMPOTENCY_KEY_SHAPE = /^[A-Za-z0-9_-]{8,100}$/;

export interface BillingSummary {
  plan: CandidatePlan;
  capabilities: string[];
  subscriptionStatus: string;
  effectiveUntil: string | null;
  version: number;
}

export interface CheckoutStarted {
  paymentId: string;
  checkoutId: string;
  redirectUrl: string;
  reused: boolean;
}

export interface DevPlanSwitched {
  plan: CandidatePlan;
  changed: boolean;
}

/**
 * The browser-facing side of billing (BFF). Everything here follows three
 * rules:
 *
 *  1. The SUBJECT is always the authenticated caller. No method takes a
 *     userId from a request body; controllers pass `@CurrentUser('id')`.
 *  2. The Java Payment Service is reached ONLY through the one internal
 *     client — its base URL and service token never exist browser-side,
 *     and no upstream error text is ever forwarded.
 *  3. Unknown truth is an error, not a guess: a billing page rendered from
 *     a made-up default would tell a paying customer they are FREE. The
 *     summary answers 503 when the authority cannot be read. (Enforcement
 *     is different and stays fail-closed-to-FREE — that path is the
 *     entitlements source, not this service.)
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly payments: PaymentServiceClient,
    @Inject(ENTITLEMENTS_SOURCE) private readonly source: EntitlementsSource,
  ) {}

  /**
   * The caller's billing state — ONLY fields the Java contract actually
   * exposes ({plan, capabilities, subscriptionStatus, effectiveUntil,
   * version}); nothing invented, no period/pending fields it does not
   * publish. The capability list is derived from the LOCAL policy table —
   * the same one the guard enforces with and `/auth/me` publishes — so no
   * two surfaces can disagree about what a plan grants.
   */
  async summary(userId: string): Promise<BillingSummary> {
    const entitlements = await this.payments.entitlementsFor(userId);
    if (!entitlements) {
      throw this.unavailable(
        BILLING_UNAVAILABLE,
        'Billing information is not available right now.',
      );
    }
    return {
      plan: entitlements.plan,
      capabilities: grantedCapabilities(entitlements.plan),
      subscriptionStatus: entitlements.subscriptionStatus,
      effectiveUntil: entitlements.effectiveUntil,
      version: entitlements.version,
    };
  }

  /**
   * Start a checkout for the CALLER. The browser names a plan; this side
   * supplies the userId, the service credential and the Idempotency-Key.
   *
   * A client MAY send its own `Idempotency-Key` header (the standard
   * double-click/retry defense — the Java unique constraint scopes it to
   * the caller's own billing account, so it can never touch anyone
   * else's order); absent one, a fresh UUID is generated per request.
   */
  async checkout(
    userId: string,
    plan: CandidatePlan,
    clientIdempotencyKey?: string,
  ): Promise<CheckoutStarted> {
    if (plan === 'FREE') {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: 'FREE has nothing to purchase.',
        code: PLAN_NOT_PURCHASABLE,
      });
    }

    const idempotencyKey = this.resolveIdempotencyKey(clientIdempotencyKey);
    const result = await this.payments.createCheckout(
      userId,
      plan,
      idempotencyKey,
    );
    if (result.kind !== 'ok') {
      // 'rejected' here means the payment service refused input THIS side
      // already validated — a contract bug worth a log line, but to the
      // browser both are the same honest answer: not right now.
      this.logger.warn(`Checkout did not complete (${result.kind})`);
      throw this.unavailable(
        CHECKOUT_UNAVAILABLE,
        'Checkout is not available right now.',
      );
    }
    return this.validatedRedirect(result);
  }

  /**
   * QA plan switch for the CALLER's own account, dev/test environments
   * only (the controller route 404s in production; the Java endpoint it
   * calls does not exist there either). On success the local entitlement
   * cache is invalidated immediately — the next gated request re-reads the
   * Payment Service — and the Kafka ENTITLEMENT_CHANGED event the Java
   * outbox emits will invalidate again, harmlessly.
   */
  async devPlanSwitch(
    userId: string,
    plan: CandidatePlan,
  ): Promise<DevPlanSwitched> {
    const result = await this.payments.devSwitchPlan(userId, plan);
    if (result.kind !== 'ok') {
      this.logger.warn(`Dev plan switch did not complete (${result.kind})`);
      throw this.unavailable(
        PLAN_SWITCH_UNAVAILABLE,
        'Plan switching is not available right now.',
      );
    }
    await this.source.invalidate(userId);
    return { plan: result.plan, changed: result.changed };
  }

  /**
   * Cancel the CALLER's paid subscription at period end. Nothing is
   * revoked now: the paid plan runs to `effectiveUntil`, then resolves to
   * FREE — the Java authority owns that timing. Answers the refreshed
   * billing summary so the UI can show CANCEL_AT_PERIOD_END immediately.
   */
  async cancel(userId: string): Promise<BillingSummary> {
    const result = await this.payments.cancelSubscription(userId);
    if (result.kind === 'rejected') {
      // Definitive refusal: no active paid subscription to cancel.
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: 'There is no active paid subscription to cancel.',
        code: NOTHING_TO_CANCEL,
      });
    }
    if (result.kind !== 'ok') {
      throw this.unavailable(
        CANCEL_UNAVAILABLE,
        'Cancellation is not available right now.',
      );
    }
    await this.source.invalidate(userId);
    return this.summary(userId);
  }

  /**
   * Schedule a downgrade for the CALLER at period end.
   *
   * FREE is routed to {@link cancel} — leaving paid entirely IS
   * cancellation, one semantic per intent. MAX is refused here (nothing is
   * above it to downgrade from). The Java side independently enforces the
   * direction rule, so even a bypassed BFF cannot turn "downgrade" into a
   * free upgrade.
   */
  async downgrade(
    userId: string,
    plan: CandidatePlan,
  ): Promise<BillingSummary> {
    if (plan === 'FREE') {
      return this.cancel(userId);
    }
    if (plan === 'MAX') {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: 'MAX is not a downgrade target.',
        code: DOWNGRADE_NOT_ALLOWED,
      });
    }
    const result = await this.payments.scheduleDowngrade(userId, plan);
    if (result.kind === 'rejected') {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: 'This downgrade is not possible from the current plan.',
        code: DOWNGRADE_NOT_ALLOWED,
      });
    }
    if (result.kind !== 'ok') {
      throw this.unavailable(
        DOWNGRADE_UNAVAILABLE,
        'Downgrading is not available right now.',
      );
    }
    await this.source.invalidate(userId);
    return this.summary(userId);
  }

  private resolveIdempotencyKey(clientKey?: string): string {
    if (clientKey === undefined || clientKey === '') return randomUUID();
    if (!IDEMPOTENCY_KEY_SHAPE.test(clientKey)) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Idempotency-Key must be 8-100 characters of [A-Za-z0-9_-].',
        code: INVALID_IDEMPOTENCY_KEY,
      });
    }
    return clientKey;
  }

  /**
   * The redirect URL is the one upstream value a browser will FOLLOW, so it
   * is not passed through on trust: it must parse as an absolute http(s)
   * URL or the checkout is refused. A checkout answer that would require
   * handing the browser a javascript:/data:/relative target is treated as
   * an outage, never forwarded.
   */
  private validatedRedirect(result: CheckoutCreated): CheckoutStarted {
    let parsed: URL;
    try {
      parsed = new URL(result.redirectUrl);
    } catch {
      this.logger.error('Checkout redirectUrl did not parse; refusing');
      throw this.unavailable(
        CHECKOUT_UNAVAILABLE,
        'Checkout is not available right now.',
      );
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      this.logger.error(
        `Checkout redirectUrl had scheme ${parsed.protocol}; refusing`,
      );
      throw this.unavailable(
        CHECKOUT_UNAVAILABLE,
        'Checkout is not available right now.',
      );
    }
    return {
      paymentId: result.paymentId,
      checkoutId: result.checkoutId,
      redirectUrl: result.redirectUrl,
      reused: result.reused,
    };
  }

  private unavailable(
    code: string,
    message: string,
  ): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message,
      code,
    });
  }
}
