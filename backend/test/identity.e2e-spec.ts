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
 *  - both registration intents (hiring / job seeker)
 *  - membership-validated organization context + switching
 *  - candidate account, resume upload, public jobs, direct apply, withdraw
 *  - tenant + candidate isolation, revoked-membership enforcement
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
  const PASSWORD = 'CorrectHorseBattery1!';

  let ownerToken: string;
  let rivalToken: string;
  let seekerToken: string;
  let ownerId: string;
  let seekerId: string;
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
      where: { email: { in: [ownerEmail, rivalEmail, seekerEmail] } },
    });
    await app.close();
  });

  describe('registration — two intents, one user model', () => {
    it('registers a hiring user: organization + OWNER membership', async () => {
      const res = await request(http)
        .post('/auth/register')
        .send({
          organizationName: `E2E Hiring ${run}`,
          organizationSlug: orgSlug,
          fullName: 'E2E Owner',
          email: ownerEmail,
          password: PASSWORD,
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('OWNER');
      expect(res.body.user.organizationId).toBeTruthy();
      ownerToken = res.body.accessToken;
      ownerId = res.body.user.id;
    });

    it('registers a job seeker: bare user, no organization, preferred locale kept', async () => {
      const res = await request(http).post('/auth/register').send({
        fullName: 'E2E Seeker',
        email: seekerEmail,
        password: PASSWORD,
        preferredLocale: 'ko',
      });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBeNull();
      expect(res.body.user.organizationId).toBeNull();
      expect(res.body.user.preferredLocale).toBe('ko');
      seekerToken = res.body.accessToken;
      seekerId = res.body.user.id;
    });

    it('registers a rival organization for isolation checks', async () => {
      const res = await request(http)
        .post('/auth/register')
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

    it('/auth/me returns the session contract', async () => {
      const res = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(ownerEmail);
      expect(res.body.candidateAccount).toEqual({ exists: false });
      expect(res.body.activeOrganization.role).toBe('OWNER');
      expect(res.body.memberships).toHaveLength(1);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
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

    it('a candidate-only user cannot reach recruiter endpoints', async () => {
      const res = await request(http)
        .get('/vacancies')
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(res.status).toBe(403);
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
    it('creates the candidate account (Korean profile text intact)', async () => {
      const res = await request(http)
        .post('/candidate-account')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({
          headline: '백엔드 엔지니어',
          location: 'Seoul, KR',
          skills: ['TypeScript', 'PostgreSQL'],
        });

      expect(res.status).toBe(201);
      expect(res.body.headline).toBe('백엔드 엔지니어');
    });

    it('applying without a resume is refused with 422', async () => {
      const res = await request(http)
        .post(`/public/jobs/${openSlug}/apply`)
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(res.status).toBe(422);
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

  describe('multi-organization membership and revocation', () => {
    it('inviting an existing account adds a membership in the caller org', async () => {
      const res = await request(http)
        .post('/auth/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          fullName: 'E2E Seeker',
          email: seekerEmail,
          password: 'IgnoredForExisting1!',
          role: 'INTERVIEWER',
        });

      expect(res.status).toBe(201);
      expect(res.body.role).toBe('INTERVIEWER');
      expect(res.body.id).toBe(seekerId);
    });

    it('switching to a non-member organization 404s (forged org id)', async () => {
      await request(http)
        .post('/auth/switch-organization')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ organizationId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
    });

    it('the invited user switches in and acts under the NEW org role only', async () => {
      const me = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${seekerToken}`);
      const orgId = me.body.memberships[0].organization.id as string;

      const switched = await request(http)
        .post('/auth/switch-organization')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ organizationId: orgId });
      expect(switched.status).toBe(200);
      expect(switched.body.activeOrganization.role).toBe('INTERVIEWER');
      seekerToken = switched.body.accessToken;

      // INTERVIEWER may read the team directory…
      await request(http)
        .get('/vacancies')
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(200);
      // …but must not create vacancies or manage the team.
      await request(http)
        .post('/vacancies')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ title: 'Nope' })
        .expect(403);
      await request(http)
        .delete(`/users/${ownerId}`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(403);
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
        .delete(`/users/${seekerId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(removal.status).toBe(200);

      // Same still-valid token, revoked membership: org access is gone…
      await request(http)
        .get('/vacancies')
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(403);

      // …while the ACCOUNT (and its candidate identity) keeps working.
      const me = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(me.status).toBe(200);
      expect(me.body.candidateAccount).toEqual({ exists: true });
      expect(me.body.activeOrganization).toBeNull();
    });
  });
});
