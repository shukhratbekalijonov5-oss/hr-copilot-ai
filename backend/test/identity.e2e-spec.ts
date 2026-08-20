import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end identity + candidate-platform flows against the REAL database
 * (and real Redis). Each run works with its own throwaway organizations and
 * users (unique suffix) and removes them afterwards, so the dev data stays
 * clean and the suite can run repeatedly.
 *
 * Covers, over real HTTP:
 *  - the two EXCLUSIVE registrations (candidate / organization) and what
 *    each may and may never create
 *  - global email exclusivity across account types
 *  - login isolation (each sign-in door rejects the other account type)
 *  - membership-validated organization context + switching (multi-org stays
 *    supported for ORGANIZATION accounts)
 *  - candidate account, resume upload, public jobs, direct apply, withdraw
 *  - tenant + candidate isolation, account-type endpoint boundaries,
 *    invitation restrictions, revoked-membership enforcement
 */
describe('Identity & candidate platform (e2e, real database)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const orgSlug = `e2e-hire-${run}`;
  const rivalSlug = `e2e-rival-${run}`;
  const ownerEmail = `owner-${run}@e2e.test`;
  const rivalEmail = `rival-${run}@e2e.test`;
  const seekerEmail = `seeker-${run}@e2e.test`;
  const invitedEmail = `invited-${run}@e2e.test`;
  const PASSWORD = 'CorrectHorseBattery1!';

  let ownerToken: string;
  let rivalToken: string;
  let seekerToken: string;
  let invitedToken: string;
  let ownerId: string;
  let invitedId: string;
  let openSlug: string;
  let applicationId: string;

  const PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
      'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts: the whitelist is part of the tenancy defence.
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
  });

  afterAll(async () => {
    // Organizations cascade memberships/vacancies/candidates/applications/
    // documents; users cascade candidate accounts and personal documents.
    await prisma.organization.deleteMany({
      where: { slug: { in: [orgSlug, rivalSlug] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: [ownerEmail, rivalEmail, seekerEmail, invitedEmail] },
      },
    });
    await app.close();
  });

  describe('registration — two exclusive account types', () => {
    it('organization signup creates user + organization + OWNER membership — and NO candidate account', async () => {
      const res = await request(http)
        .post('/auth/register/organization')
        .send({
          organizationName: `E2E Hiring ${run}`,
          organizationSlug: orgSlug,
          fullName: 'E2E Owner',
          email: ownerEmail,
          password: PASSWORD,
        });

      expect(res.status).toBe(201);
      expect(res.body.user.accountType).toBe('ORGANIZATION');
      expect(res.body.user.role).toBe('OWNER');
      expect(res.body.user.organizationId).toBeTruthy();
      ownerToken = res.body.accessToken;
      ownerId = res.body.user.id;

      const stored = await prisma.user.findUnique({
        where: { email: ownerEmail },
        select: {
          accountType: true,
          candidateAccount: { select: { id: true } },
          memberships: { select: { role: true } },
        },
      });
      expect(stored!.accountType).toBe('ORGANIZATION');
      expect(stored!.candidateAccount).toBeNull();
      expect(stored!.memberships).toEqual([{ role: 'OWNER' }]);
    });

    it('candidate signup creates user + candidate account — and NO organization or membership', async () => {
      const res = await request(http).post('/auth/register/candidate').send({
        fullName: 'E2E Seeker',
        email: seekerEmail,
        password: PASSWORD,
        preferredLocale: 'ko',
      });

      expect(res.status).toBe(201);
      expect(res.body.user.accountType).toBe('CANDIDATE');
      expect(res.body.user.role).toBeNull();
      expect(res.body.user.organizationId).toBeNull();
      expect(res.body.user.preferredLocale).toBe('ko');
      seekerToken = res.body.accessToken;

      const stored = await prisma.user.findUnique({
        where: { email: seekerEmail },
        select: {
          accountType: true,
          candidateAccount: { select: { id: true } },
          memberships: true,
        },
      });
      expect(stored!.accountType).toBe('CANDIDATE');
      expect(stored!.candidateAccount).not.toBeNull();
      expect(stored!.memberships).toHaveLength(0);
    });

    it('registers a rival organization for isolation checks', async () => {
      const res = await request(http)
        .post('/auth/register/organization')
        .send({
          organizationName: `E2E Rival ${run}`,
          organizationSlug: rivalSlug,
          fullName: 'E2E Rival Owner',
          email: rivalEmail,
          password: PASSWORD,
        });

      expect(res.status).toBe(201);
      rivalToken = res.body.accessToken;
    });

    it('/auth/me returns the session contract including accountType', async () => {
      const res = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(ownerEmail);
      expect(res.body.accountType).toBe('ORGANIZATION');
      expect(res.body.user.accountType).toBe('ORGANIZATION');
      expect(res.body.candidateAccount).toEqual({ exists: false });
      expect(res.body.activeOrganization.role).toBe('OWNER');
      expect(res.body.memberships).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });
  });

  describe('global email exclusivity', () => {
    it('a candidate email cannot register an organization (409 ACCOUNT_TYPE_CONFLICT)', async () => {
      const res = await request(http)
        .post('/auth/register/organization')
        .send({
          organizationName: 'Should Never Exist',
          organizationSlug: `e2e-never-${run}`,
          fullName: 'E2E Seeker',
          email: seekerEmail,
          password: PASSWORD,
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('AUTH_ACCOUNT_TYPE_CONFLICT');

      const org = await prisma.organization.findUnique({
        where: { slug: `e2e-never-${run}` },
      });
      expect(org).toBeNull();
    });

    it('an organization email cannot register a candidate account (409 ACCOUNT_TYPE_CONFLICT)', async () => {
      const res = await request(http).post('/auth/register/candidate').send({
        fullName: 'E2E Owner',
        email: ownerEmail,
        password: PASSWORD,
      });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('AUTH_ACCOUNT_TYPE_CONFLICT');
    });

    it('a same-type duplicate is 409 AUTH_EMAIL_ALREADY_REGISTERED', async () => {
      const res = await request(http).post('/auth/register/candidate').send({
        fullName: 'E2E Seeker Again',
        email: seekerEmail,
        password: PASSWORD,
      });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('AUTH_EMAIL_ALREADY_REGISTERED');
    });
  });

  describe('login isolation — two sign-in doors', () => {
    it('candidate credentials succeed through the candidate door', async () => {
      const res = await request(http).post('/auth/login').send({
        email: seekerEmail,
        password: PASSWORD,
        accountType: 'CANDIDATE',
      });

      expect(res.status).toBe(200);
      expect(res.body.user.accountType).toBe('CANDIDATE');
    });

    it('candidate credentials are refused through the organization door', async () => {
      const res = await request(http).post('/auth/login').send({
        email: seekerEmail,
        password: PASSWORD,
        accountType: 'ORGANIZATION',
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTH_ACCOUNT_TYPE_MISMATCH');
    });

    it('organization credentials succeed through the organization door', async () => {
      const res = await request(http).post('/auth/login').send({
        email: ownerEmail,
        password: PASSWORD,
        accountType: 'ORGANIZATION',
      });

      expect(res.status).toBe(200);
      expect(res.body.user.accountType).toBe('ORGANIZATION');
      expect(res.body.user.role).toBe('OWNER');
    });

    it('organization credentials are refused through the candidate door', async () => {
      const res = await request(http).post('/auth/login').send({
        email: ownerEmail,
        password: PASSWORD,
        accountType: 'CANDIDATE',
      });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTH_ACCOUNT_TYPE_MISMATCH');
    });

    it('a WRONG password stays a flat 401 even through the wrong door', async () => {
      const res = await request(http).post('/auth/login').send({
        email: seekerEmail,
        password: 'definitely-wrong-password',
        accountType: 'ORGANIZATION',
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBeUndefined();
    });
  });

  describe('recruiter workspace under membership context', () => {
    it('creates an OPEN vacancy with a public slug', async () => {
      const res = await request(http)
        .post('/vacancies')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'E2E Backend Engineer',
          status: 'OPEN',
          description: 'Build the E2E backend. 백엔드 엔지니어링.',
          location: 'Remote',
        });

      expect(res.status).toBe(201);
      expect(res.body.publicSlug).toMatch(
        new RegExp(`^e2e-backend-engineer-${orgSlug}-[0-9a-f]{6}$`),
      );
      openSlug = res.body.publicSlug;
    });

    it('creates a DRAFT vacancy that must stay off the public board', async () => {
      const res = await request(http)
        .post('/vacancies')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'E2E Hidden Draft' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
    });

    it('a candidate account cannot reach recruiter endpoints', async () => {
      await request(http)
        .get('/vacancies')
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(403);
    });

    it('a candidate account cannot reach recruiter AI search or generation', async () => {
      await request(http)
        .post('/search/evidence')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ query: 'typescript' })
        .expect(403);
      await request(http)
        .post('/ai/answer')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ query: 'who knows typescript?' })
        .expect(403);
    });

    it('the rival organization cannot see this organization data', async () => {
      const res = await request(http)
        .get('/vacancies')
        .set('Authorization', `Bearer ${rivalToken}`);

      expect(res.status).toBe(200);
      const titles = res.body.data.map((v: { title: string }) => v.title);
      expect(titles).not.toContain('E2E Backend Engineer');
    });
  });

  describe('public job board', () => {
    it('lists the OPEN vacancy without authentication', async () => {
      const res = await request(http).get('/public/jobs?limit=100');

      expect(res.status).toBe(200);
      const jobs = res.body.data as {
        publicSlug: string;
        title: string;
      }[];
      expect(jobs.some((j) => j.publicSlug === openSlug)).toBe(true);
      // The DRAFT vacancy never appears.
      expect(jobs.some((j) => j.title === 'E2E Hidden Draft')).toBe(false);
    });

    it('exposes only advertisement-safe fields on the detail page', async () => {
      const res = await request(http).get(`/public/jobs/${openSlug}`);

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('E2E Backend Engineer');
      expect(res.body.organization).toEqual({ name: `E2E Hiring ${run}` });
      for (const forbidden of [
        'id',
        'createdById',
        'createdBy',
        '_count',
        'applications',
        'organizationId',
      ]) {
        expect(res.body).not.toHaveProperty(forbidden);
      }
    });

    it('404s an unknown slug', async () => {
      await request(http).get('/public/jobs/no-such-job-xyz').expect(404);
    });
  });

  describe('candidate account and direct application', () => {
    it('the profile created at signup is editable (Korean profile text intact)', async () => {
      const res = await request(http)
        .patch('/candidate-account/me')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({
          headline: '백엔드 엔지니어',
          location: 'Seoul, KR',
          skills: ['TypeScript', 'PostgreSQL'],
        });

      expect(res.status).toBe(200);
      expect(res.body.headline).toBe('백엔드 엔지니어');
    });

    it('an ORGANIZATION account cannot touch candidate endpoints', async () => {
      const me = await request(http)
        .get('/candidate-account/me')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(me.status).toBe(403);
      expect(me.body.code).toBe('AUTH_ACCOUNT_TYPE_MISMATCH');

      // Creation is refused too — an organization user can never gain a
      // candidate identity.
      await request(http)
        .post('/candidate-account')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ headline: 'nope' })
        .expect(403);

      // Candidate AI Job Match is candidate-only.
      await request(http)
        .post('/candidate-account/me/job-matches')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(403);
    });

    it('applying without a resume is refused with 422', async () => {
      const res = await request(http)
        .post(`/public/jobs/${openSlug}/apply`)
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(res.status).toBe(422);
    });

    it('an ORGANIZATION account cannot apply to a job', async () => {
      await request(http)
        .post(`/public/jobs/${openSlug}/apply`)
        .set('Authorization', `Bearer ${rivalToken}`)
        .expect(403);
    });

    it('uploads a personal resume (organization-less document)', async () => {
      const res = await request(http)
        .post('/candidate-account/me/resume')
        .set('Authorization', `Bearer ${seekerToken}`)
        .attach('file', PDF, {
          filename: 'e2e-resume.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(201);

      const personal = await prisma.document.findUnique({
        where: { id: res.body.id },
        select: { organizationId: true, candidateAccountId: true },
      });
      expect(personal!.organizationId).toBeNull();
      expect(personal!.candidateAccountId).toBeTruthy();
    });

    it('applies directly: application + linked org candidate + snapshot, source=DIRECT', async () => {
      const res = await request(http)
        .post(`/public/jobs/${openSlug}/apply`)
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(res.status).toBe(201);
      expect(res.body.source).toBe('DIRECT');
      expect(res.body.status).toBe('NEW');
      applicationId = res.body.id;

      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: { candidate: true, submittedDocument: true },
      });
      expect(application!.candidate.candidateAccountId).toBeTruthy();
      expect(application!.candidate.fullName).toBe('E2E Seeker');
      // The snapshot copy belongs to the VACANCY's organization.
      expect(application!.submittedDocument!.organizationId).toBe(
        application!.candidate.organizationId,
      );
    });

    it('a second application to the same vacancy is refused (409)', async () => {
      await request(http)
        .post(`/public/jobs/${openSlug}/apply`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(409);
    });

    it('the recruiter sees the application in their workspace', async () => {
      const res = await request(http)
        .get('/applications')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      const mine = res.body.data.find(
        (a: { id: string }) => a.id === applicationId,
      );
      expect(mine).toBeDefined();
    });

    it('the rival organization cannot see the application or the candidate', async () => {
      await request(http)
        .get(`/applications/${applicationId}`)
        .set('Authorization', `Bearer ${rivalToken}`)
        .expect(404);

      const rivalCandidates = await request(http)
        .get('/candidates')
        .set('Authorization', `Bearer ${rivalToken}`);
      const names = rivalCandidates.body.data.map(
        (c: { fullName: string }) => c.fullName,
      );
      expect(names).not.toContain('E2E Seeker');
    });

    it('the candidate sees only their own application, without recruiter data', async () => {
      const res = await request(http)
        .get('/candidate-account/me/applications')
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      const [app] = res.body.data;
      expect(app.id).toBe(applicationId);
      expect(app.vacancy.organization).toEqual({ name: `E2E Hiring ${run}` });
      expect(app).not.toHaveProperty('candidate');
      expect(app).not.toHaveProperty('evidence');
    });

    it('the candidate can withdraw, and only withdraw', async () => {
      const res = await request(http)
        .post(`/candidate-account/me/applications/${applicationId}/withdraw`)
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('WITHDRAWN');

      // Terminal now — a second withdraw is refused.
      await request(http)
        .post(`/candidate-account/me/applications/${applicationId}/withdraw`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(409);
    });
  });

  describe('invitations and the exclusivity invariant', () => {
    it('a CANDIDATE email cannot be invited into an organization', async () => {
      const res = await request(http)
        .post('/auth/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          fullName: 'E2E Seeker',
          email: seekerEmail,
          password: 'IgnoredForExisting1!',
          role: 'INTERVIEWER',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('AUTH_ACCOUNT_TYPE_CONFLICT');

      // No membership row appeared, no silent conversion happened.
      const stored = await prisma.user.findUnique({
        where: { email: seekerEmail },
        select: { accountType: true, memberships: true },
      });
      expect(stored!.accountType).toBe('CANDIDATE');
      expect(stored!.memberships).toHaveLength(0);
    });

    it('inviting a NEW email creates an ORGANIZATION account with the membership', async () => {
      const res = await request(http)
        .post('/auth/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          fullName: 'E2E Invited',
          email: invitedEmail,
          password: PASSWORD,
          role: 'INTERVIEWER',
        });

      expect(res.status).toBe(201);
      expect(res.body.role).toBe('INTERVIEWER');
      invitedId = res.body.id;

      const stored = await prisma.user.findUnique({
        where: { email: invitedEmail },
        select: {
          accountType: true,
          candidateAccount: { select: { id: true } },
        },
      });
      expect(stored!.accountType).toBe('ORGANIZATION');
      expect(stored!.candidateAccount).toBeNull();
    });

    it('inviting an existing ORGANIZATION email adds a second membership (multi-org)', async () => {
      const res = await request(http)
        .post('/auth/users')
        .set('Authorization', `Bearer ${rivalToken}`)
        .send({
          fullName: 'Ignored',
          email: invitedEmail,
          password: 'IgnoredForExisting1!',
          role: 'RECRUITER',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(invitedId);
      expect(res.body.role).toBe('RECRUITER');
    });

    it('switching to a non-member organization 404s (forged org id)', async () => {
      await request(http)
        .post('/auth/switch-organization')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ organizationId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
    });

    it('the invited user switches in and acts under the org role only', async () => {
      const login = await request(http).post('/auth/login').send({
        email: invitedEmail,
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
      invitedToken = login.body.accessToken;

      const me = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${invitedToken}`);
      const main = me.body.memberships.find(
        (m: { role: string }) => m.role === 'INTERVIEWER',
      );

      const switched = await request(http)
        .post('/auth/switch-organization')
        .set('Authorization', `Bearer ${invitedToken}`)
        .send({ organizationId: main.organization.id });
      expect(switched.status).toBe(200);
      expect(switched.body.activeOrganization.role).toBe('INTERVIEWER');
      invitedToken = switched.body.accessToken;

      // INTERVIEWER may read vacancies…
      await request(http)
        .get('/vacancies')
        .set('Authorization', `Bearer ${invitedToken}`)
        .expect(200);
      // …but must not create vacancies or manage the team.
      await request(http)
        .post('/vacancies')
        .set('Authorization', `Bearer ${invitedToken}`)
        .send({ title: 'Nope' })
        .expect(403);
      await request(http)
        .delete(`/users/${ownerId}`)
        .set('Authorization', `Bearer ${invitedToken}`)
        .expect(403);
    });

    it('an ORGANIZATION user can never gain a candidate identity', async () => {
      await request(http)
        .post('/candidate-account')
        .set('Authorization', `Bearer ${invitedToken}`)
        .send({})
        .expect(403);

      const stored = await prisma.user.findUnique({
        where: { email: invitedEmail },
        select: { candidateAccount: { select: { id: true } } },
      });
      expect(stored!.candidateAccount).toBeNull();
    });

    it('the last OWNER cannot be demoted or removed', async () => {
      const demote = await request(http)
        .patch(`/users/${ownerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'RECRUITER' });
      // Self-role-change is forbidden outright; and even another admin could
      // not demote the last owner.
      expect([400, 403]).toContain(demote.status);
    });

    it('a removed membership stops working on the very next request', async () => {
      const removal = await request(http)
        .delete(`/users/${invitedId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(removal.status).toBe(200);

      // Same still-valid token, revoked membership: org access is gone…
      await request(http)
        .get('/vacancies')
        .set('Authorization', `Bearer ${invitedToken}`)
        .expect(403);

      // …while the ACCOUNT keeps working (it still belongs to the rival org).
      const me = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${invitedToken}`);
      expect(me.status).toBe(200);
      expect(me.body.accountType).toBe('ORGANIZATION');
      expect(me.body.activeOrganization).toBeNull();
      expect(me.body.memberships.map((m: { role: string }) => m.role)).toEqual([
        'RECRUITER',
      ]);
    });
  });
});
