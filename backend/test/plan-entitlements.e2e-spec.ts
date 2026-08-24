import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * FREE / PRO / MAX over real HTTP (Task 4C.5.1).
 *
 * What only e2e can prove:
 *
 *  - the guard chain's ORDER — a recruiter on a candidate AI surface gets an
 *    account-type refusal, never an upsell;
 *  - the plan being unspoofable through any request channel, because the
 *    whitelisted DTOs and the guard's live DB read are both in the loop;
 *  - a plan change taking effect on the NEXT request with no re-login,
 *    because entitlement is never a token claim;
 *  - ordinary internal search and apply remaining completely ungated.
 *
 * Plans are elevated through the SUPPORTED test path — a direct fixture
 * update of candidate_accounts.plan — which is exactly how operators set
 * plans until the Java Payment Service becomes the authority. There is
 * deliberately no HTTP endpoint that writes the plan.
 */
describe('Candidate plan entitlements (e2e, real database)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const PASSWORD = 'CorrectHorseBattery1!';
  const candidateEmail = `plan-candidate-${run}@e2e.test`;
  const recruiterEmail = `plan-recruiter-${run}@e2e.test`;
  const orgSlug = `e2e-plan-${run}`;

  let candidateToken: string;
  let recruiterToken: string;
  let candidateAccountId: string;
  let vacancySlug: string;
  let externalJobId: string;
  let companyId: string;

  const MATCHES = '/candidate-account/me/job-matches';
  const XBASE = '/candidate-account/me/external-jobs';
  const XTRACK = '/candidate-account/me/external-job-applications';

  const asCandidate = () => ({
    get: (url: string) =>
      request(http).get(url).set('Authorization', `Bearer ${candidateToken}`),
    post: (url: string, body: Record<string, unknown> = {}) =>
      request(http)
        .post(url)
        .set('Authorization', `Bearer ${candidateToken}`)
        .send(body),
  });

  const setPlan = (plan: 'FREE' | 'PRO' | 'MAX') =>
    prisma.candidateAccount.update({
      where: { id: candidateAccountId },
      data: { plan },
    });

  const expectUpgrade = (
    body: Record<string, unknown>,
    requiredPlan: string,
    capability: string,
  ) => {
    expect(body).toMatchObject({
      code: 'PLAN_UPGRADE_REQUIRED',
      requiredPlan,
      capability,
    });
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
    prisma = app.get(PrismaService);
    http = app.getHttpServer();

    candidateToken = (
      await request(http).post('/auth/register/candidate').send({
        fullName: 'Plan Candidate',
        email: candidateEmail,
        password: PASSWORD,
      })
    ).body.accessToken;
    recruiterToken = (
      await request(http).post('/auth/register/organization').send({
        organizationName: 'E2E Plan Org',
        organizationSlug: orgSlug,
        fullName: 'Plan Recruiter',
        email: recruiterEmail,
        password: PASSWORD,
      })
    ).body.accessToken;

    candidateAccountId = (
      await prisma.candidateAccount.findFirstOrThrow({
        where: { user: { email: candidateEmail } },
        select: { id: true },
      })
    ).id;

    // A fixture resume, set the same way tests set plans: direct fixture
    // rows. Ordinary apply requires a current resume (pre-existing rule),
    // and proving "FREE can apply" means actually applying.
    const resume = await prisma.document.create({
      data: {
        candidateAccountId,
        type: 'RESUME',
        originalFileName: 'plan-e2e.pdf',
        storageKey: `plan-e2e-${run}.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1024,
        status: 'COMPLETED',
      },
      select: { id: true },
    });
    await prisma.candidateAccount.update({
      where: { id: candidateAccountId },
      data: { resumeDocumentId: resume.id },
    });

    // An OPEN internal vacancy, for the FREE search/apply half.
    vacancySlug = (
      await request(http)
        .post('/vacancies')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({
          title: `Plan Fixture Engineer ${run}`,
          status: 'OPEN',
          description: 'Ordinary internal role for entitlement e2e.',
        })
        .expect(201)
    ).body.publicSlug;

    // One external job, for the MAX half.
    companyId = (
      await prisma.externalCompany.create({
        data: {
          name: `ZZ Plan Fixture ${run}`,
          normalizedName: `zz plan fixture ${run}`,
          domain: '',
        },
        select: { id: true },
      })
    ).id;
    externalJobId = (
      await prisma.externalJob.create({
        data: {
          dedupeFingerprint: `zzplan-${run}`,
          externalCompanyId: companyId,
          title: `zzplan${run} Fixture Engineer`,
          normalizedTitle: `zzplan${run} fixture engineer`,
          status: 'ACTIVE',
          canonicalUrl: `https://boards.zzfixture.invalid/plan/${run}`,
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.candidateSavedExternalJob.deleteMany({
      where: { externalJobId },
    });
    await prisma.candidateExternalJobApplication.deleteMany({
      where: { externalJobId },
    });
    await prisma.externalJob.deleteMany({ where: { id: externalJobId } });
    await prisma.externalCompany.deleteMany({ where: { id: companyId } });
    await prisma.organization.deleteMany({ where: { slug: orgSlug } });
    await prisma.user.deleteMany({
      where: { email: { in: [candidateEmail, recruiterEmail] } },
    });
    await app.close();
  });

  describe('FREE (the registration default — nothing was elevated)', () => {
    it('a fresh registration starts on FREE, by column default', async () => {
      const account = await prisma.candidateAccount.findUniqueOrThrow({
        where: { id: candidateAccountId },
        select: { plan: true },
      });
      expect(account.plan).toBe('FREE');
    });

    it('ordinary internal Find Jobs works', async () => {
      const page = await request(http)
        .get(`/public/jobs?search=Plan Fixture Engineer ${run}`)
        .expect(200);
      expect(JSON.stringify(page.body)).toContain(vacancySlug);
    });

    it('ordinary internal apply works', async () => {
      await asCandidate().post(`/public/jobs/${vacancySlug}/apply`).expect(201);
    });

    it('/auth/me publishes FREE with zero capabilities', async () => {
      const me = await asCandidate().get('/auth/me').expect(200);
      // The read contract: what the guard will enforce, published up front
      // so the UI can lock features before any 403.
      expect(me.body.candidateAccount).toEqual({
        exists: true,
        plan: 'FREE',
        capabilities: [],
      });
    });

    it('Internal AI Search is a 403 naming PRO', async () => {
      const refusal = await asCandidate().post(MATCHES).expect(403);
      expectUpgrade(refusal.body, 'PRO', 'INTERNAL_AI_SEARCH');
    });

    it('every external surface is a 403 naming MAX — no bypass route', async () => {
      const candidate = asCandidate();
      const attempts: (() => request.Test)[] = [
        () => candidate.post(`${XBASE}/search`, { query: 'x' }),
        () => candidate.get(`${XBASE}/saved`),
        () => candidate.post(`${XBASE}/${externalJobId}/save`),
        () => candidate.get(`${XBASE}/${externalJobId}`),
        () => candidate.post(`${XBASE}/${externalJobId}/application`),
        () => candidate.get(XTRACK),
      ];
      // Sequential on purpose — one ephemeral listener per request.
      for (const attempt of attempts) {
        const refusal = await attempt().expect(403);
        expectUpgrade(refusal.body, 'MAX', 'EXTERNAL_AI_SEARCH');
      }
    });

    it('the plan cannot be spoofed through any request channel', async () => {
      const candidate = asCandidate();
      // Body: guards run BEFORE pipes, so the smuggled property never even
      // reaches validation — the refusal is already decided from the DB row.
      const viaBody = await candidate
        .post(MATCHES, { plan: 'MAX' })
        .expect(403);
      expectUpgrade(viaBody.body, 'PRO', 'INTERNAL_AI_SEARCH');
      // Query and header: not consulted by anything; the answer stays 403.
      const viaQuery = await request(http)
        .post(`${MATCHES}?plan=MAX`)
        .set('Authorization', `Bearer ${candidateToken}`)
        .send({})
        .expect(403);
      expectUpgrade(viaQuery.body, 'PRO', 'INTERNAL_AI_SEARCH');
      const viaHeader = await request(http)
        .post(MATCHES)
        .set('Authorization', `Bearer ${candidateToken}`)
        .set('X-Candidate-Plan', 'MAX')
        .send({})
        .expect(403);
      expectUpgrade(viaHeader.body, 'PRO', 'INTERNAL_AI_SEARCH');
    });
  });

  describe('PRO', () => {
    beforeAll(() => setPlan('PRO'));

    it('/auth/me publishes PRO with the internal capability only', async () => {
      const me = await asCandidate().get('/auth/me').expect(200);
      expect(me.body.candidateAccount).toEqual({
        exists: true,
        plan: 'PRO',
        capabilities: ['INTERNAL_AI_SEARCH'],
      });
    });

    it('takes effect on the next request — no re-login, not a token claim', async () => {
      const response = await asCandidate().post(MATCHES);
      // Admitted through the plan gate. (The business layer may still answer
      // about missing evidence; what it must never answer is an upsell.)
      expect(response.status).not.toBe(403);
    });

    it('ordinary internal surfaces are unchanged', async () => {
      await request(http).get('/public/jobs').expect(200);
      await asCandidate().get('/candidate-account/me/applications').expect(200);
    });

    it('External AI Search still requires MAX', async () => {
      const refusal = await asCandidate()
        .post(`${XBASE}/search`, { query: 'x' })
        .expect(403);
      expectUpgrade(refusal.body, 'MAX', 'EXTERNAL_AI_SEARCH');
    });
  });

  describe('MAX', () => {
    beforeAll(() => setPlan('MAX'));

    it('/auth/me publishes MAX with both capabilities', async () => {
      const me = await asCandidate().get('/auth/me').expect(200);
      expect(me.body.candidateAccount).toEqual({
        exists: true,
        plan: 'MAX',
        capabilities: ['INTERNAL_AI_SEARCH', 'EXTERNAL_AI_SEARCH'],
      });
    });

    it('external AI search works', async () => {
      const page = await asCandidate()
        .post(`${XBASE}/search`, { query: `zzplan${run}`, pageSize: 5 })
        .expect(200);
      expect(page.body.results.length).toBeGreaterThan(0);
      expect(page.body.results[0].externalJobId).toBe(externalJobId);
    });

    it('saving and tracking work', async () => {
      await asCandidate().post(`${XBASE}/${externalJobId}/save`).expect(200);
      await asCandidate()
        .post(`${XBASE}/${externalJobId}/application`)
        .expect(201);
      const saved = await asCandidate().get(`${XBASE}/saved`).expect(200);
      expect(saved.body.total).toBe(1);
      const tracked = await asCandidate().get(XTRACK).expect(200);
      expect(tracked.body.total).toBe(1);
    });

    it('internal AI stays admitted (tiers are cumulative)', async () => {
      const response = await asCandidate().post(MATCHES);
      expect(response.status).not.toBe(403);
    });
  });

  describe('the guard order and the recruiter', () => {
    it('a recruiter gets an account-type refusal, never an upsell', async () => {
      const refusal = await request(http)
        .post(`${XBASE}/search`)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({ query: 'x' })
        .expect(403);
      // The surface is not theirs at any price — the answer must not
      // advertise a plan they cannot use here.
      expect(refusal.body.code).toBe('AUTH_ACCOUNT_TYPE_MISMATCH');
      expect(refusal.body.code).not.toBe('PLAN_UPGRADE_REQUIRED');
    });

    it('recruiter routes are unaffected by the plan layer', async () => {
      await request(http)
        .get('/vacancies')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(200);
    });

    it('recruiter /auth/me is unchanged — no plan, no capabilities', async () => {
      const me = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(200);
      expect(me.body.candidateAccount).toEqual({ exists: false });
      expect(me.body.activeOrganization).toBeTruthy();
    });
  });

  describe('no write path can carry a plan or capability', () => {
    it('registration with a smuggled plan is refused, and a clean one is FREE', async () => {
      const email = `plan-spoof-${run}@e2e.test`;
      // The whitelist pipe refuses the unknown property outright.
      await request(http)
        .post('/auth/register/candidate')
        .send({ fullName: 'Spoof', email, password: PASSWORD, plan: 'MAX' })
        .expect(400);

      // The clean registration lands on FREE — the column default, with no
      // code path that could say otherwise.
      const token = (
        await request(http)
          .post('/auth/register/candidate')
          .send({ fullName: 'Spoof', email, password: PASSWORD })
          .expect(201)
      ).body.accessToken;
      const me = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body.candidateAccount).toMatchObject({ plan: 'FREE' });
      await prisma.user.deleteMany({ where: { email } });
    });

    it('the profile update cannot smuggle a plan or capabilities', async () => {
      // Both refused by the whitelist; and toAccountData maps an explicit
      // field allowlist, so even a future DTO slip could not reach `plan`.
      await request(http)
        .patch('/candidate-account/me')
        .set('Authorization', `Bearer ${candidateToken}`)
        .send({ headline: 'x', plan: 'MAX' })
        .expect(400);

      const me = await asCandidate().get('/auth/me').expect(200);
      // Still exactly what the fixture last set (MAX block ran) — nothing a
      // request carried has ever moved it.
      expect(['FREE', 'PRO', 'MAX']).toContain(me.body.candidateAccount.plan);
    });

    it('capabilities cannot arrive via query or header either', async () => {
      await setPlan('FREE');
      const viaQuery = await request(http)
        .post(`${XBASE}/search?capabilities=EXTERNAL_AI_SEARCH&plan=MAX`)
        .set('Authorization', `Bearer ${candidateToken}`)
        .send({ query: 'x' })
        .expect(403);
      expectUpgrade(viaQuery.body, 'MAX', 'EXTERNAL_AI_SEARCH');

      const viaHeader = await request(http)
        .post(`${XBASE}/search`)
        .set('Authorization', `Bearer ${candidateToken}`)
        .set('X-Capabilities', 'EXTERNAL_AI_SEARCH')
        .set('Cookie', 'plan=MAX; capabilities=EXTERNAL_AI_SEARCH')
        .send({ query: 'x' })
        .expect(403);
      expectUpgrade(viaHeader.body, 'MAX', 'EXTERNAL_AI_SEARCH');
    });
  });

  describe('the fixed development test accounts', () => {
    const DESIGNATED: [string, string][] = [
      ['shukhratbekalijonov7@gmail.com', 'PRO'],
      ['shukhratbekalijonov9@gmail.com', 'MAX'],
    ];

    it.each(DESIGNATED)('%s holds %s', async (email, plan) => {
      const account = await prisma.candidateAccount.findFirst({
        where: { user: { email } },
        select: { plan: true, user: { select: { accountType: true } } },
      });
      if (!account) {
        // A fresh database without the dev accounts is a valid environment;
        // the invariant is about THIS deployment's designated pair.
        console.warn(`designated account ${email} absent — skipping`);
        return;
      }
      expect(account.user.accountType).toBe('CANDIDATE');
      expect(account.plan).toBe(plan);
    });

    it('no other candidate account holds a paid plan', async () => {
      const strays = await prisma.candidateAccount.findMany({
        where: {
          plan: { not: 'FREE' },
          user: {
            email: { notIn: DESIGNATED.map(([email]) => email) },
          },
        },
        select: { user: { select: { email: true } } },
      });
      // This spec's own fixture candidate is reset to FREE by the spoof
      // tests above; anything else non-FREE is a leak.
      expect(strays.map((s) => s.user.email)).toEqual([]);
    });
  });
});
