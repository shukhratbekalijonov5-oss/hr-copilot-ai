import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The vacancy-scoped HR workspace rule, end to end (real database + Redis).
 *
 * The critical fixture (§35): HR A and HR B in the SAME organization —
 * organization membership alone must not grant access to each other's
 * vacancies. Proves over real HTTP that HR A:
 *
 *  - sees only their own vacancies in My Vacancies;
 *  - cannot mutate / close / bulk-delete / list candidates of / run Compare
 *    (evidence-map) / AI-context / chat against HR B's vacancy;
 *  - CAN do all of that inside their own vacancies, whose candidate lists
 *    contain exactly the people who applied to them;
 *  - deleting own vacancies purges their conversations (chat lifecycle).
 *
 * Fixtures are throwaway (unique suffix) and removed afterwards.
 */
describe('Vacancy-scoped HR workspace (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const orgSlug = `e2e-ws-${run}`;
  const rivalSlug = `e2e-ws-rival-${run}`;
  const hrAEmail = `ws-hra-${run}@e2e.test`;
  const hrBEmail = `ws-hrb-${run}@e2e.test`;
  const rivalEmail = `ws-rival-${run}@e2e.test`;
  const seekerEmail = `ws-seeker-${run}@e2e.test`;
  const seeker2Email = `ws-seeker2-${run}@e2e.test`;
  const PASSWORD = 'CorrectHorseBattery1!';

  let hrAToken: string;
  let hrBToken: string;
  let rivalToken: string;
  let seekerToken: string;
  let seeker2Token: string;

  let vacancyA1: string; // created by HR A
  let vacancyA2: string; // created by HR A
  let vacancyB1: string; // created by HR B (same org!)
  let rivalVacancy: string; // another organization entirely

  let seeker2CandidateId: string; // second applicant's org-side record on A1
  let platformCandidateId: string; // seeker's org-side record in A1 (applied)
  let a1Slug: string;
  let a2Slug: string;

  const PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );

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

    // One organization with TWO HR users, plus a rival org and a job seeker.
    const hrA = await request(http).post('/auth/register/organization').send({
      organizationName: 'E2E Workspace Org',
      organizationSlug: orgSlug,
      fullName: 'HR A',
      email: hrAEmail,
      password: PASSWORD,
    });
    hrAToken = hrA.body.accessToken;

    await request(http)
      .post('/auth/users')
      .set('Authorization', `Bearer ${hrAToken}`)
      .send({
        fullName: 'HR B',
        email: hrBEmail,
        password: PASSWORD,
        role: 'HR_ADMIN',
      })
      .expect(201);
    const hrB = await request(http)
      .post('/auth/login')
      .send({ email: hrBEmail, password: PASSWORD });
    hrBToken = hrB.body.accessToken;

    const rival = await request(http).post('/auth/register/organization').send({
      organizationName: 'E2E Workspace Rival',
      organizationSlug: rivalSlug,
      fullName: 'Rival HR',
      email: rivalEmail,
      password: PASSWORD,
    });
    rivalToken = rival.body.accessToken;

    const seeker = await request(http).post('/auth/register/candidate').send({
      fullName: 'WS Seeker',
      email: seekerEmail,
      password: PASSWORD,
    });
    seekerToken = seeker.body.accessToken;

    const seeker2 = await request(http).post('/auth/register/candidate').send({
      fullName: 'WS Seeker Two',
      email: seeker2Email,
      password: PASSWORD,
    });
    seeker2Token = seeker2.body.accessToken;

    // Vacancies: A1/A2 by HR A, B1 by HR B (same org), one rival vacancy.
    const create = async (token: string, title: string) => {
      const res = await request(http)
        .post('/vacancies')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title,
          status: 'OPEN',
          description: 'E2E workspace test role',
        })
        .expect(201);
      return res.body as { id: string; publicSlug: string };
    };
    const a1 = await create(hrAToken, 'WS Backend Engineer A1');
    vacancyA1 = a1.id;
    a1Slug = a1.publicSlug;
    const a2 = await create(hrAToken, 'WS Data Engineer A2');
    vacancyA2 = a2.id;
    a2Slug = a2.publicSlug;
    vacancyB1 = (await create(hrBToken, 'WS Frontend Engineer B1')).id;
    rivalVacancy = (await create(rivalToken, 'WS Rival Role')).id;

    await request(http)
      .post(`/vacancies/${vacancyA1}/requirements`)
      .set('Authorization', `Bearer ${hrAToken}`)
      .send({ text: 'NestJS', type: 'SKILL', required: true })
      .expect(201);

    // Two applicants onto A1 — the ONLY way anybody enters a pipeline.
    const applyTo = async (token: string, slug: string, email: string) => {
      await request(http)
        .post('/candidate-account/me/resume')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', PDF, {
          filename: 'ws-resume.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      await request(http)
        .post(`/public/jobs/${slug}/apply`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      const candidate = await prisma.candidate.findFirstOrThrow({
        where: {
          organization: { slug: orgSlug },
          candidateAccount: { user: { email } },
        },
        select: { id: true },
      });
      return candidate.id;
    };
    platformCandidateId = await applyTo(seekerToken, a1Slug, seekerEmail);
    seeker2CandidateId = await applyTo(seeker2Token, a1Slug, seeker2Email);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { slug: { in: [orgSlug, rivalSlug] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [hrAEmail, hrBEmail, rivalEmail, seekerEmail, seeker2Email],
        },
      },
    });
    await app.close();
  });

  describe('My Vacancies', () => {
    it('HR A sees exactly A1/A2 — never same-org B1, never rival vacancies', async () => {
      const res = await request(http)
        .get('/vacancies/mine')
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(200);

      const ids = res.body.data.map((v: { id: string }) => v.id).sort();
      expect(ids).toEqual([vacancyA1, vacancyA2].sort());
      // Slim selector rows with counts.
      const a1Row = res.body.data.find(
        (v: { id: string }) => v.id === vacancyA1,
      );
      expect(a1Row).toMatchObject({
        title: 'WS Backend Engineer A1',
        status: 'OPEN',
        candidateCount: 2,
      });
      expect(a1Row).not.toHaveProperty('description');
    });

    it('HR B sees exactly B1', async () => {
      const res = await request(http)
        .get('/vacancies/mine')
        .set('Authorization', `Bearer ${hrBToken}`)
        .expect(200);
      expect(res.body.data.map((v: { id: string }) => v.id)).toEqual([
        vacancyB1,
      ]);
    });

    it('a candidate account cannot call it at all', async () => {
      await request(http)
        .get('/vacancies/mine')
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(403);
    });
  });

  describe('same-org other-HR isolation (§35)', () => {
    it('HR A cannot edit, close or delete B1 — 403 VACANCY_NOT_OWNED', async () => {
      const edit = await request(http)
        .patch(`/vacancies/${vacancyB1}`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ title: 'Hijacked' });
      expect(edit.status).toBe(403);
      expect(edit.body.code).toBe('VACANCY_NOT_OWNED');

      await request(http)
        .patch(`/vacancies/${vacancyB1}/close`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(403);
      await request(http)
        .delete(`/vacancies/${vacancyB1}`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(403);
    });

    it('a rival-org vacancy stays an undisclosing 404', async () => {
      await request(http)
        .patch(`/vacancies/${rivalVacancy}`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ title: 'Hijacked' })
        .expect(404);
    });

    it('nobody can add a candidate into ANY vacancy — the route is gone', async () => {
      // Not "403 for B1": recruiter-created candidates were removed from the
      // product, so the endpoint itself no longer exists for their own
      // vacancy either.
      await request(http)
        .post('/candidates')
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ vacancyId: vacancyB1, fullName: 'Smuggled' })
        .expect(404);
      await request(http)
        .post('/candidates')
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ vacancyId: vacancyA1, fullName: 'Smuggled' })
        .expect(404);
    });

    it('HR A cannot list B1 candidates or use B1 as any AI/search/processing context', async () => {
      await request(http)
        .get(`/vacancies/${vacancyB1}/candidates`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(403);
      await request(http)
        .post('/search/evidence')
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ query: 'kubernetes', vacancyId: vacancyB1 })
        .expect(403);
      await request(http)
        .get(`/processing-jobs?vacancyId=${vacancyB1}`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(403);
      await request(http)
        .get(`/conversations?vacancyId=${vacancyB1}`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(403);
    });

    it('HR A cannot run Compare (evidence-map) under B1', async () => {
      const res = await request(http)
        .get(
          `/candidates/${seeker2CandidateId}/vacancies/${vacancyB1}/evidence-map`,
        )
        .set('Authorization', `Bearer ${hrAToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('VACANCY_NOT_OWNED');
    });

    it('HR A cannot bulk-delete a batch containing B1 — nothing is deleted', async () => {
      const res = await request(http)
        .post('/vacancies/bulk-delete')
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ vacancyIds: [vacancyA2, vacancyB1] });
      expect(res.status).toBe(403);

      // Both survive.
      const survivors = await prisma.vacancy.count({
        where: { id: { in: [vacancyA2, vacancyB1] } },
      });
      expect(survivors).toBe(2);
    });
  });

  describe('vacancy-scoped candidates', () => {
    it('A1 lists exactly the two people who applied to it', async () => {
      const res = await request(http)
        .get(`/vacancies/${vacancyA1}/candidates`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      const ids = res.body.data
        .map((row: { candidate: { id: string } }) => row.candidate.id)
        .sort();
      expect(ids).toEqual([platformCandidateId, seeker2CandidateId].sort());
      // Every row is an applicant, so there is no source/account label to
      // render — the distinction the old contract carried no longer exists.
      expect(res.body.data[0].application).not.toHaveProperty('source');
      expect(res.body.data[0].candidate).not.toHaveProperty(
        'hasCandidateAccount',
      );
    });

    it('HR cannot attach an existing candidate to a vacancy — the route is gone', async () => {
      await request(http)
        .post('/applications')
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ vacancyId: vacancyA2, candidateId: platformCandidateId })
        .expect(404);

      const a2 = await request(http)
        .get(`/vacancies/${vacancyA2}/candidates`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(200);
      expect(a2.body.data).toEqual([]);
    });

    it('a candidate joins a second vacancy by applying to it themselves', async () => {
      await request(http)
        .post(`/public/jobs/${a2Slug}/apply`)
        .set('Authorization', `Bearer ${seeker2Token}`)
        .expect(201);

      const after = await request(http)
        .get(`/vacancies/${vacancyA2}/candidates`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(200);
      expect(after.body.data).toHaveLength(1);
      expect(after.body.data[0].candidate.id).toBe(seeker2CandidateId);
      // A1 still shows its own two — per-vacancy state never bleeds.
      const a1 = await request(http)
        .get(`/vacancies/${vacancyA1}/candidates`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(200);
      expect(a1.body.data).toHaveLength(2);
    });

    it('applying twice to the same vacancy is refused', async () => {
      await request(http)
        .post(`/public/jobs/${a2Slug}/apply`)
        .set('Authorization', `Bearer ${seeker2Token}`)
        .expect(409);
    });

    it('candidate-detail AI requires the candidate to be IN the selected vacancy', async () => {
      // platform candidate is in A1 but NOT in A2.
      const res = await request(http)
        .post(`/ai/candidates/${platformCandidateId}/summary`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ vacancyId: vacancyA2 });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CANDIDATE_NOT_IN_VACANCY');
    });

    it('Ask about a candidate without a selected vacancy is a 400', async () => {
      await request(http)
        .post('/ai/answer')
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({
          query: 'Does this applicant know NestJS?',
          candidateId: seeker2CandidateId,
        })
        .expect(400);
    });
  });

  describe('HR interview chat — vacancy first, creator only', () => {
    let conversationId: string;

    beforeAll(async () => {
      // Invite the platform candidate on A1 → unlocks the ONE conversation.
      const application = await prisma.application.findFirstOrThrow({
        where: { vacancyId: vacancyA1, candidateId: platformCandidateId },
        select: { id: true },
      });
      const res = await request(http)
        .post(`/applications/${application.id}/invite-interview`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(201);
      conversationId = res.body.conversation.id;
    });

    it('HR A lists it under A1; the unfiltered list is still creator-scoped', async () => {
      const filtered = await request(http)
        .get(`/conversations?vacancyId=${vacancyA1}`)
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(200);
      expect(filtered.body.data.map((c: { id: string }) => c.id)).toContain(
        conversationId,
      );

      const unfiltered = await request(http)
        .get('/conversations')
        .set('Authorization', `Bearer ${hrAToken}`)
        .expect(200);
      expect(
        unfiltered.body.data.every(
          (c: { vacancyId: string }) =>
            c.vacancyId === vacancyA1 || c.vacancyId === vacancyA2,
        ),
      ).toBe(true);
    });

    it('HR B (same org, live membership) cannot see, read or write it', async () => {
      const list = await request(http)
        .get('/conversations')
        .set('Authorization', `Bearer ${hrBToken}`)
        .expect(200);
      expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(
        conversationId,
      );

      // Guessing the id buys nothing: 404, indistinguishable from missing.
      await request(http)
        .get(`/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${hrBToken}`)
        .expect(404);
      await request(http)
        .get(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${hrBToken}`)
        .expect(404);
      await request(http)
        .post(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${hrBToken}`)
        .send({ content: 'infiltration attempt' })
        .expect(404);
    });

    it('HR B cannot invite on A1 either', async () => {
      const application = await prisma.application.findFirstOrThrow({
        where: { vacancyId: vacancyA1, candidateId: seeker2CandidateId },
        select: { id: true },
      });
      await request(http)
        .post(`/applications/${application.id}/invite-interview`)
        .set('Authorization', `Bearer ${hrBToken}`)
        .expect(403);
    });

    it('the candidate side is untouched: the seeker still sees their own chat directly', async () => {
      const list = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(200);
      expect(list.body.data.map((c: { id: string }) => c.id)).toContain(
        conversationId,
      );
      // Vacancy identity is on the card — no vacancy selector needed first.
      expect(list.body.data[0].vacancy.title).toBeDefined();
    });
  });

  describe('bulk delete of OWN vacancies + lifecycle purge', () => {
    it('deletes A1+A2, purges their conversations, and B1 survives', async () => {
      const conversationsBefore = await prisma.conversation.count({
        where: { vacancyId: { in: [vacancyA1, vacancyA2] } },
      });
      expect(conversationsBefore).toBeGreaterThan(0);

      const res = await request(http)
        .post('/vacancies/bulk-delete')
        .set('Authorization', `Bearer ${hrAToken}`)
        .send({ vacancyIds: [vacancyA1, vacancyA2] })
        .expect(200);
      expect(res.body).toEqual({
        deletedIds: [vacancyA1, vacancyA2],
        deletedCount: 2,
      });

      expect(
        await prisma.vacancy.count({
          where: { id: { in: [vacancyA1, vacancyA2] } },
        }),
      ).toBe(0);
      expect(
        await prisma.conversation.count({
          where: { vacancyId: { in: [vacancyA1, vacancyA2] } },
        }),
      ).toBe(0);
      expect(
        await prisma.conversationMessage.count({
          where: {
            conversation: { vacancyId: { in: [vacancyA1, vacancyA2] } },
          },
        }),
      ).toBe(0);
      // The colleague's vacancy is untouched.
      expect(await prisma.vacancy.count({ where: { id: vacancyB1 } })).toBe(1);
    });
  });
});
