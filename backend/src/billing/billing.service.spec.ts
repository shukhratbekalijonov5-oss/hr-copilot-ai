import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  BillingService,
  BILLING_UNAVAILABLE,
  CANCEL_UNAVAILABLE,
  CHECKOUT_UNAVAILABLE,
  DOWNGRADE_NOT_ALLOWED,
  DOWNGRADE_UNAVAILABLE,
  INVALID_IDEMPOTENCY_KEY,
  NOTHING_TO_CANCEL,
  PLAN_NOT_PURCHASABLE,
  PLAN_SWITCH_UNAVAILABLE,
} from './billing.service';
import type { PaymentServiceClient } from '../entitlements/payment-service.client';
import type { EntitlementsSource } from '../entitlements/entitlements-source';

/**
 * The billing BFF's contract: caller-only subjects, stable browser errors
 * that never carry upstream text, a validated redirect, and immediate cache
 * invalidation after a dev switch.
 */

function clientFake(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    configured: true,
    entitlementsFor: jest.fn(() => Promise.resolve(null)),
    createCheckout: jest.fn(() =>
      Promise.resolve({ kind: 'unavailable' as const }),
    ),
    devSwitchPlan: jest.fn(() =>
      Promise.resolve({ kind: 'unavailable' as const }),
    ),
    cancelSubscription: jest.fn(() =>
      Promise.resolve({ kind: 'unavailable' as const }),
    ),
    scheduleDowngrade: jest.fn(() =>
      Promise.resolve({ kind: 'unavailable' as const }),
    ),
    ...overrides,
  } as unknown as PaymentServiceClient & {
    entitlementsFor: jest.Mock;
    createCheckout: jest.Mock;
    devSwitchPlan: jest.Mock;
    cancelSubscription: jest.Mock;
    scheduleDowngrade: jest.Mock;
  };
}

function sourceFake() {
  return {
    planFor: jest.fn(() => Promise.resolve('FREE')),
    invalidate: jest.fn(() => Promise.resolve()),
  } as unknown as EntitlementsSource & { invalidate: jest.Mock };
}

function codeOf(error: unknown): string | undefined {
  return (
    (error as { getResponse?: () => unknown }).getResponse?.() as {
      code?: string;
    }
  )?.code;
}

const ENTITLED = {
  userId: 'user-1',
  plan: 'PRO' as const,
  capabilities: ['INTERNAL_AI_SEARCH'],
  subscriptionStatus: 'ACTIVE',
  effectiveUntil: '2026-09-23T10:00:00Z',
  version: 4,
};

const CHECKOUT_OK = {
  kind: 'ok' as const,
  paymentId: 'pay-1',
  checkoutId: 'mock_co_1',
  redirectUrl: 'https://sandbox.invalid/checkout/mock_co_1',
  reused: false,
};

describe('billing summary', () => {
  it('exposes ONLY fields the Java contract actually has, with locally-derived capabilities', async () => {
    const client = clientFake({
      entitlementsFor: jest.fn(() => Promise.resolve(ENTITLED)),
    });
    const service = new BillingService(client, sourceFake());

    const summary = await service.summary('user-1');
    expect(summary).toEqual({
      plan: 'PRO',
      capabilities: ['INTERNAL_AI_SEARCH'],
      subscriptionStatus: 'ACTIVE',
      effectiveUntil: '2026-09-23T10:00:00Z',
      version: 4,
    });
    // Nothing fabricated: no currentPeriodEnd / pendingPlan / effectiveAt /
    // cancelAtPeriodEnd — Java does not expose them, so neither do we.
    expect(Object.keys(summary).sort()).toEqual([
      'capabilities',
      'effectiveUntil',
      'plan',
      'subscriptionStatus',
      'version',
    ]);
  });

  it('answers 503 when the billing authority cannot be read — never a made-up FREE page', async () => {
    const service = new BillingService(clientFake(), sourceFake());
    const error = await service.summary('user-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(codeOf(error)).toBe(BILLING_UNAVAILABLE);
  });
});

describe('checkout', () => {
  it('FREE is refused with 422 before any upstream call', async () => {
    const client = clientFake();
    const service = new BillingService(client, sourceFake());

    const error = await service
      .checkout('user-1', 'FREE')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(codeOf(error)).toBe(PLAN_NOT_PURCHASABLE);
    expect(client.createCheckout).not.toHaveBeenCalled();
  });

  it('derives the SUBJECT from the caller and generates a server-side idempotency key', async () => {
    const client = clientFake({
      createCheckout: jest.fn(() => Promise.resolve(CHECKOUT_OK)),
    });
    const service = new BillingService(client, sourceFake());

    const result = await service.checkout('caller-7', 'PRO');
    expect(result).toEqual({
      paymentId: 'pay-1',
      checkoutId: 'mock_co_1',
      redirectUrl: 'https://sandbox.invalid/checkout/mock_co_1',
      reused: false,
    });
    const [userId, plan, key] = client.createCheckout.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(userId).toBe('caller-7'); // the authenticated caller, nothing else
    expect(plan).toBe('PRO');
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,100}$/); // a generated UUID
  });

  it('forwards a well-formed client Idempotency-Key so browser retries reuse the same order', async () => {
    const client = clientFake({
      createCheckout: jest.fn(() =>
        Promise.resolve({ ...CHECKOUT_OK, reused: true }),
      ),
    });
    const service = new BillingService(client, sourceFake());

    const result = await service.checkout('user-1', 'MAX', 'retry-abc-123');
    expect(result.reused).toBe(true);
    expect(client.createCheckout).toHaveBeenCalledWith(
      'user-1',
      'MAX',
      'retry-abc-123',
    );
  });

  it('a malformed client Idempotency-Key is a 400, not a pass-through', async () => {
    const client = clientFake();
    const service = new BillingService(client, sourceFake());

    const error = await service
      .checkout('user-1', 'PRO', 'bad key with spaces!')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(codeOf(error)).toBe(INVALID_IDEMPOTENCY_KEY);
    expect(client.createCheckout).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'rejected'] as const)(
    'upstream %s maps to a stable 503 with no upstream text',
    async (kind) => {
      const client = clientFake({
        createCheckout: jest.fn(() => Promise.resolve({ kind })),
      });
      const service = new BillingService(client, sourceFake());

      const error = await service
        .checkout('user-1', 'PRO')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(codeOf(error)).toBe(CHECKOUT_UNAVAILABLE);
      const body = (error as ServiceUnavailableException).getResponse();
      expect(Object.keys(body as object).sort()).toEqual([
        'code',
        'error',
        'message',
        'statusCode',
      ]);
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    '/relative/path',
    'not a url',
  ])('refuses to hand the browser the redirect %s', async (redirectUrl) => {
    const client = clientFake({
      createCheckout: jest.fn(() =>
        Promise.resolve({ ...CHECKOUT_OK, redirectUrl }),
      ),
    });
    const service = new BillingService(client, sourceFake());

    const error = await service
      .checkout('user-1', 'PRO')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(codeOf(error)).toBe(CHECKOUT_UNAVAILABLE);
    expect(
      JSON.stringify((error as ServiceUnavailableException).getResponse()),
    ).not.toContain(redirectUrl);
  });
});

describe('cancel', () => {
  it('schedules cancel-at-period-end for the CALLER, invalidates the cache, answers the summary', async () => {
    const client = clientFake({
      cancelSubscription: jest.fn(() =>
        Promise.resolve({ kind: 'ok' as const, cancelAtPeriodEnd: true }),
      ),
      entitlementsFor: jest.fn(() =>
        Promise.resolve({
          ...ENTITLED,
          subscriptionStatus: 'CANCEL_AT_PERIOD_END',
        }),
      ),
    });
    const source = sourceFake();
    const service = new BillingService(client, source);

    const summary = await service.cancel('user-1');

    expect(client.cancelSubscription).toHaveBeenCalledWith('user-1');
    expect(source.invalidate).toHaveBeenCalledWith('user-1');
    expect(summary.subscriptionStatus).toBe('CANCEL_AT_PERIOD_END');
    expect(summary.plan).toBe('PRO'); // the paid period still runs
  });

  it('a definitive refusal (nothing to cancel) is a coded 422, and invalidates nothing', async () => {
    const client = clientFake({
      cancelSubscription: jest.fn(() =>
        Promise.resolve({ kind: 'rejected' as const }),
      ),
    });
    const source = sourceFake();
    const service = new BillingService(client, source);

    const error = await service.cancel('user-1').catch((e: unknown) => e);
    expect(codeOf(error)).toBe(NOTHING_TO_CANCEL);
    expect(source.invalidate).not.toHaveBeenCalled();
  });

  it('an outage is a stable 503', async () => {
    const service = new BillingService(clientFake(), sourceFake());
    const error = await service.cancel('user-1').catch((e: unknown) => e);
    expect(codeOf(error)).toBe(CANCEL_UNAVAILABLE);
  });
});

describe('downgrade', () => {
  it('schedules a paid downgrade, invalidates, and answers the summary', async () => {
    const client = clientFake({
      scheduleDowngrade: jest.fn(() =>
        Promise.resolve({ kind: 'ok' as const, pendingPlan: 'PRO' as const }),
      ),
      entitlementsFor: jest.fn(() => Promise.resolve(ENTITLED)),
    });
    const source = sourceFake();
    const service = new BillingService(client, source);

    await service.downgrade('user-1', 'PRO');

    expect(client.scheduleDowngrade).toHaveBeenCalledWith('user-1', 'PRO');
    expect(source.invalidate).toHaveBeenCalledWith('user-1');
  });

  it('FREE routes to cancellation — leaving paid entirely IS cancel-at-period-end', async () => {
    const client = clientFake({
      cancelSubscription: jest.fn(() =>
        Promise.resolve({ kind: 'ok' as const, cancelAtPeriodEnd: true }),
      ),
      entitlementsFor: jest.fn(() => Promise.resolve(ENTITLED)),
    });
    const service = new BillingService(client, sourceFake());

    await service.downgrade('user-1', 'FREE');

    expect(client.cancelSubscription).toHaveBeenCalledWith('user-1');
    expect(client.scheduleDowngrade).not.toHaveBeenCalled();
  });

  it('MAX is refused locally with a coded 422 — nothing is above it', async () => {
    const client = clientFake();
    const service = new BillingService(client, sourceFake());
    const error = await service
      .downgrade('user-1', 'MAX')
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(DOWNGRADE_NOT_ALLOWED);
    expect(client.scheduleDowngrade).not.toHaveBeenCalled();
  });

  it('an upstream refusal (wrong direction / no active sub) is a coded 422', async () => {
    const client = clientFake({
      scheduleDowngrade: jest.fn(() =>
        Promise.resolve({ kind: 'rejected' as const }),
      ),
    });
    const service = new BillingService(client, sourceFake());
    const error = await service
      .downgrade('user-1', 'PRO')
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(DOWNGRADE_NOT_ALLOWED);
  });

  it('an outage is a stable 503', async () => {
    const service = new BillingService(clientFake(), sourceFake());
    const error = await service
      .downgrade('user-1', 'PRO')
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe(DOWNGRADE_UNAVAILABLE);
  });
});

describe('dev plan switch', () => {
  it('switches the CALLER and invalidates their cache immediately', async () => {
    const client = clientFake({
      devSwitchPlan: jest.fn(() =>
        Promise.resolve({ kind: 'ok', plan: 'MAX', changed: true }),
      ),
    });
    const source = sourceFake();
    const service = new BillingService(client, source);

    const result = await service.devPlanSwitch('caller-9', 'MAX');
    expect(result).toEqual({ plan: 'MAX', changed: true });
    expect(client.devSwitchPlan).toHaveBeenCalledWith('caller-9', 'MAX');
    expect(source.invalidate).toHaveBeenCalledWith('caller-9');
  });

  it('an upstream failure is a stable 503 and does NOT invalidate anything', async () => {
    const source = sourceFake();
    const service = new BillingService(clientFake(), source);

    const error = await service
      .devPlanSwitch('user-1', 'PRO')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(codeOf(error)).toBe(PLAN_SWITCH_UNAVAILABLE);
    expect(source.invalidate).not.toHaveBeenCalled();
  });
});
