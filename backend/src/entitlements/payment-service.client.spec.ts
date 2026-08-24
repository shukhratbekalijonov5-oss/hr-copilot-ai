import { ConfigService } from '@nestjs/config';
import { PaymentServiceClient } from './payment-service.client';

/**
 * The MUTATION side of the one payment-service client (checkout, dev plan
 * switch). The entitlement-read side is covered in
 * payment-entitlements.source.spec.ts; what these tests pin down is the
 * outcome mapping — ok / rejected / unavailable — and that no upstream
 * response text and no secret ever appears in what the client returns.
 */

function configOf(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, fallback: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function clientWith(fetchImpl: typeof fetch): PaymentServiceClient {
  global.fetch = fetchImpl;
  return new PaymentServiceClient(
    configOf({
      'entitlements.paymentServiceUrl': 'http://payments.internal:8081',
      'entitlements.paymentServiceToken': 'svc-token',
      'entitlements.timeoutMs': 50,
    }),
  );
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

const CHECKOUT_OK = {
  paymentId: 'pay-1',
  checkoutId: 'mock_co_1',
  redirectUrl: 'https://sandbox.invalid/checkout/mock_co_1',
  reused: false,
};

describe('createCheckout', () => {
  it('maps a valid response and sends userId, plan and the Idempotency-Key server-side', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const client = clientWith(((url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(CHECKOUT_OK),
      });
    }) as unknown as typeof fetch);

    const result = await client.createCheckout('user-1', 'PRO', 'key-12345678');
    expect(result).toEqual({ kind: 'ok', ...CHECKOUT_OK });
    expect(seenUrl).toBe('http://payments.internal:8081/internal/checkout');
    expect(seenInit?.headers).toMatchObject({
      'X-Internal-Token': 'svc-token',
      'Idempotency-Key': 'key-12345678',
    });
    const requestBody = seenInit?.body;
    expect(typeof requestBody).toBe('string');
    expect(JSON.parse(requestBody as string)).toEqual({
      userId: 'user-1',
      plan: 'PRO',
    });
  });

  it('a definitive 4xx maps to rejected — and its body is never even read', async () => {
    const json = jest.fn();
    const client = clientWith((() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json,
      })) as unknown as typeof fetch);
    expect(
      await client.createCheckout('user-1', 'PRO', 'key-12345678'),
    ).toEqual({ kind: 'rejected' });
    expect(json).not.toHaveBeenCalled();
  });

  it('a 5xx maps to unavailable', async () => {
    const client = clientWith((() =>
      Promise.resolve({ ok: false, status: 503 })) as unknown as typeof fetch);
    expect(
      await client.createCheckout('user-1', 'MAX', 'key-12345678'),
    ).toEqual({ kind: 'unavailable' });
  });

  it('a transport failure maps to unavailable', async () => {
    const client = clientWith(() => Promise.reject(new Error('ECONNREFUSED')));
    expect(
      await client.createCheckout('user-1', 'PRO', 'key-12345678'),
    ).toEqual({ kind: 'unavailable' });
  });

  it('a malformed success body maps to unavailable — shape is validated, not trusted', async () => {
    const client = clientWith((() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ paymentId: 'pay-1' }),
      })) as unknown as typeof fetch);
    expect(
      await client.createCheckout('user-1', 'PRO', 'key-12345678'),
    ).toEqual({ kind: 'unavailable' });
  });

  it('unconfigured answers unavailable without a network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    const client = new PaymentServiceClient(configOf());
    expect(
      await client.createCheckout('user-1', 'PRO', 'key-12345678'),
    ).toEqual({ kind: 'unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('cancelSubscription / scheduleDowngrade', () => {
  it('cancel posts to the caller-scoped internal route with the service credential', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const client = clientWith((url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({ userId: 'u1', cancelAtPeriodEnd: true }),
          {
            status: 200,
          },
        ),
      );
    });

    const result = await client.cancelSubscription('u1');

    expect(seenUrl).toBe(
      'http://payments.internal:8081/internal/subscriptions/u1/cancel',
    );
    expect(
      (seenInit?.headers as Record<string, string>)['X-Internal-Token'],
    ).toBe('svc-token');
    expect(result).toEqual({ kind: 'ok', cancelAtPeriodEnd: true });
  });

  it('a definitive 4xx on cancel maps to rejected', async () => {
    const client = clientWith(() =>
      Promise.resolve(
        new Response('{"error":"No active paid subscription"}', {
          status: 400,
        }),
      ),
    );
    expect(await client.cancelSubscription('u1')).toEqual({ kind: 'rejected' });
  });

  it('downgrade sends the target plan and maps the pending echo', async () => {
    let seenBody = '';
    const client = clientWith((url: string, init: RequestInit) => {
      seenBody = init.body as string;
      return Promise.resolve(
        new Response(JSON.stringify({ userId: 'u1', pendingPlan: 'PRO' }), {
          status: 200,
        }),
      );
    });

    const result = await client.scheduleDowngrade('u1', 'PRO');

    expect(JSON.parse(seenBody)).toEqual({ plan: 'PRO' });
    expect(result).toEqual({ kind: 'ok', pendingPlan: 'PRO' });
  });

  it('an unknown pending plan in the echo maps to unavailable — never trusted onward', async () => {
    const client = clientWith(() =>
      Promise.resolve(
        new Response(JSON.stringify({ pendingPlan: 'ULTRA' }), { status: 200 }),
      ),
    );
    expect(await client.scheduleDowngrade('u1', 'PRO')).toEqual({
      kind: 'unavailable',
    });
  });
});

describe('devSwitchPlan', () => {
  it('maps a valid response to the switched plan', async () => {
    const client = clientWith((() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ userId: 'user-1', plan: 'MAX', changed: true }),
      })) as unknown as typeof fetch);
    expect(await client.devSwitchPlan('user-1', 'MAX')).toEqual({
      kind: 'ok',
      plan: 'MAX',
      changed: true,
    });
  });

  it('the production 404 (controller absent in Java) maps to rejected', async () => {
    const client = clientWith((() =>
      Promise.resolve({ ok: false, status: 404 })) as unknown as typeof fetch);
    expect(await client.devSwitchPlan('user-1', 'MAX')).toEqual({
      kind: 'rejected',
    });
  });

  it('an unknown plan in the echo maps to unavailable — never trusted onward', async () => {
    const client = clientWith((() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ userId: 'user-1', plan: 'ULTRA', changed: true }),
      })) as unknown as typeof fetch);
    expect(await client.devSwitchPlan('user-1', 'MAX')).toEqual({
      kind: 'unavailable',
    });
  });

  it('no outcome variant can carry the service token or upstream text', async () => {
    const client = clientWith((() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('secret internal stack trace'),
      })) as unknown as typeof fetch);
    const outcome = await client.devSwitchPlan('user-1', 'PRO');
    expect(JSON.stringify(outcome)).not.toContain('svc-token');
    expect(JSON.stringify(outcome)).not.toContain('stack trace');
    expect(outcome).toEqual({ kind: 'unavailable' });
  });
});
