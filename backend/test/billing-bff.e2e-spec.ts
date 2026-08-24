import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

/**
 * The billing BFF over real HTTP (Payment Phase 2).
 *
 * The Java Payment Service is deliberately UNREACHABLE for this suite (the
 * URL below points at a dead port), because what only e2e can prove is the
 * boundary itself:
 *
 *  - all three routes demand an authenticated CANDIDATE — 401 without a
 *    token, an account-type refusal for an organization;
 *  - no request channel can name another user (forbidNonWhitelisted kills
 *    a smuggled userId with 400 before any code runs);
 *  - upstream outage surfaces as a STABLE coded 503 that leaks neither the
 *    internal URL, nor the service token, nor transport error text;
 *  - FREE and unknown plans die at this side's validation, never upstream;
 *  - the dev plan switch route EXISTS in a test environment (Nest answers
 *    it, not 404) — its production 404 is unit-proven in
 *    dev-environment.guard.spec.ts, and the Java prod profile drops the
 *    endpoint's bean as the second lock.
 *
 * The happy path against a LIVE payment service (FREE→MAX→FREE through
 * these routes) is exercised in live dev verification, not here — e2e must
 * pass on a machine with no Java service running.
 */

const DEAD_PAYMENT_URL = 'http://127.0.0.1:59999';
const TOKEN_SENTINEL = 'e2e-secret-internal-token-sentinel';

const savedEnv = {
  url: process.env.PAYMENT_SERVICE_URL,
  token: process.env.PAYMENT_SERVICE_INTERNAL_TOKEN,
  timeout: process.env.PAYMENT_SERVICE_TIMEOUT_MS,
};
process.env.PAYMENT_SERVICE_URL = DEAD_PAYMENT_URL;
process.env.PAYMENT_SERVICE_INTERNAL_TOKEN = TOKEN_SENTINEL;
process.env.PAYMENT_SERVICE_TIMEOUT_MS = '500';

// Imported AFTER the env pin so configuration() reads the dead URL.
import { AppModule } from '../src/app.module';

describe('Billing BFF (e2e, payment service down by design)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const PASSWORD = 'CorrectHorseBattery1!';
  const candidateEmail = `billing-candidate-${run}@e2e.test`;
  const recruiterEmail = `billing-recruiter-${run}@e2e.test`;

  let candidateToken: string;
  let recruiterToken: string;

  const BILLING = '/candidate-account/me/billing';

  /** Every browser-visible body must be free of internal material. */
  const expectNoInternalLeak = (body: unknown) => {
    const text = JSON.stringify(body);
    expect(text).not.toContain(TOKEN_SENTINEL);
    expect(text).not.toContain('59999');
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toMatch(/ECONNREFUSED|AbortError|fetch failed/i);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
    http = app.getHttpServer();

    candidateToken = (
      await request(http).post('/auth/register/candidate').send({
        fullName: 'Billing Candidate',
        email: candidateEmail,
        password: PASSWORD,
      })
    ).body.accessToken;
    recruiterToken = (
      await request(http)
        .post('/auth/register/organization')
        .send({
          organizationName: 'E2E Billing Org',
          organizationSlug: `e2e-billing-${run}`,
          fullName: 'Billing Recruiter',
          email: recruiterEmail,
          password: PASSWORD,
        })
    ).body.accessToken;
    expect(candidateToken).toBeDefined();
    expect(recruiterToken).toBeDefined();
  });

  afterAll(async () => {
    process.env.PAYMENT_SERVICE_URL = savedEnv.url ?? '';
    process.env.PAYMENT_SERVICE_INTERNAL_TOKEN = savedEnv.token ?? '';
    process.env.PAYMENT_SERVICE_TIMEOUT_MS = savedEnv.timeout ?? '';
    await app?.close();
  });

  const asCandidate = () => ({
    get: (url: string) =>
      request(http).get(url).set('Authorization', `Bearer ${candidateToken}`),
    post: (url: string, body: Record<string, unknown> = {}) =>
      request(http)
        .post(url)
        .set('Authorization', `Bearer ${candidateToken}`)
        .send(body),
  });

  describe('the boundary is candidate-only', () => {
    it.each([
      ['GET', BILLING],
      ['POST', `${BILLING}/checkout`],
      ['POST', `${BILLING}/dev-plan-switch`],
    ])('%s %s without a token → 401', async (method, url) => {
      const response =
        method === 'GET'
          ? await request(http).get(url)
          : await request(http).post(url).send({ plan: 'PRO' });
      expect(response.status).toBe(401);
    });

    it('an ORGANIZATION account gets an account-type refusal, never billing', async () => {
      const response = await request(http)
        .get(BILLING)
        .set('Authorization', `Bearer ${recruiterToken}`);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('AUTH_ACCOUNT_TYPE_MISMATCH');
    });

    it('the account-type refusal also wins on the dev switch — before any availability answer', async () => {
      const response = await request(http)
        .post(`${BILLING}/dev-plan-switch`)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ plan: 'MAX' });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('AUTH_ACCOUNT_TYPE_MISMATCH');
    });
  });

  describe('billing summary', () => {
    it('an unreachable billing authority is a coded 503, never a fabricated FREE page', async () => {
      const response = await asCandidate().get(BILLING);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('BILLING_UNAVAILABLE');
      expectNoInternalLeak(response.body);
    });
  });

  describe('checkout', () => {
    it('FREE is not a purchase — 422 with a stable code, no upstream call implied', async () => {
      const response = await asCandidate().post(`${BILLING}/checkout`, {
        plan: 'FREE',
      });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('PLAN_NOT_PURCHASABLE');
    });

    it('an unknown plan dies at validation with 400', async () => {
      const response = await asCandidate().post(`${BILLING}/checkout`, {
        plan: 'ULTRA',
      });
      expect(response.status).toBe(400);
    });

    it('a smuggled userId is rejected outright — the subject is always the caller', async () => {
      const response = await asCandidate().post(`${BILLING}/checkout`, {
        plan: 'PRO',
        userId: 'someone-else',
      });
      expect(response.status).toBe(400);
    });

    it('an unreachable payment service is a coded 503 with zero internal detail', async () => {
      const response = await asCandidate().post(`${BILLING}/checkout`, {
        plan: 'PRO',
      });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('CHECKOUT_UNAVAILABLE');
      expectNoInternalLeak(response.body);
    });

    it('a malformed client Idempotency-Key is a 400, not forwarded', async () => {
      const response = await request(http)
        .post(`${BILLING}/checkout`)
        .set('Authorization', `Bearer ${candidateToken}`)
        .set('Idempotency-Key', 'bad key!')
        .send({ plan: 'PRO' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    });
  });

  describe('cancel / downgrade', () => {
    it('cancel against an unreachable authority is a coded 503 with zero internal detail', async () => {
      const response = await asCandidate().post(`${BILLING}/cancel`);
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('CANCEL_UNAVAILABLE');
      expectNoInternalLeak(response.body);
    });

    it('cancel cannot target another user — a smuggled userId is a 400', async () => {
      const response = await asCandidate().post(`${BILLING}/cancel`, {
        userId: 'victim-user',
      });
      expect(response.status).toBe(400);
    });

    it('a paid downgrade against an unreachable authority is a coded 503', async () => {
      const response = await asCandidate().post(`${BILLING}/downgrade`, {
        plan: 'PRO',
      });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('DOWNGRADE_UNAVAILABLE');
      expectNoInternalLeak(response.body);
    });

    it('MAX is not a downgrade target — coded 422 before any upstream call', async () => {
      const response = await asCandidate().post(`${BILLING}/downgrade`, {
        plan: 'MAX',
      });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('DOWNGRADE_NOT_ALLOWED');
    });

    it('an unknown plan dies at validation with 400', async () => {
      const response = await asCandidate().post(`${BILLING}/downgrade`, {
        plan: 'LITE',
      });
      expect(response.status).toBe(400);
    });

    it('the recruiter account-type refusal wins here too', async () => {
      const response = await request(http)
        .post(`${BILLING}/cancel`)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({});
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('AUTH_ACCOUNT_TYPE_MISMATCH');
    });
  });

  describe('dev plan switch (test environment)', () => {
    it('the route EXISTS outside production — outage answers 503, not 404', async () => {
      const response = await asCandidate().post(`${BILLING}/dev-plan-switch`, {
        plan: 'MAX',
      });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('PLAN_SWITCH_UNAVAILABLE');
      expectNoInternalLeak(response.body);
    });

    it('cannot target another user — a smuggled userId is a 400', async () => {
      const response = await asCandidate().post(`${BILLING}/dev-plan-switch`, {
        plan: 'MAX',
        userId: 'victim-user',
      });
      expect(response.status).toBe(400);
    });

    it('an unknown plan dies at validation', async () => {
      const response = await asCandidate().post(`${BILLING}/dev-plan-switch`, {
        plan: 'ENTERPRISE',
      });
      expect(response.status).toBe(400);
    });
  });
});
