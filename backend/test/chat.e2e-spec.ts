import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DomainEventsService } from '../src/common/events/domain-events.service';

/**
 * End-to-end interview chat against the REAL database.
 *
 * Covers, over real HTTP, the whole product rule: chat exists only inside the
 * HR ↔ vacancy ↔ candidate interview relationship —
 *
 *  - invitation creates exactly ONE conversation per vacancy+candidate pair
 *    (idempotent under repetition), and moves the pipeline to INTERVIEW;
 *  - one vacancy holds many isolated conversations (A, B, …);
 *  - candidate A can never see candidate B; a rival organization can never
 *    see either; account-type boundaries hold in both directions;
 *  - rejection before an interview creates no chat; rejection AFTER one
 *    hard-deletes exactly that candidate's conversation and messages while
 *    every other candidate, vacancy and organization is untouched;
 *  - manual candidates without a platform account get an explicit
 *    NO_CANDIDATE_ACCOUNT state, never a fabricated conversation;
 *  - closing the vacancy permanently deletes its conversations and messages
 *    for BOTH sides while unrelated vacancies keep theirs.
 *
 * Each run uses its own throwaway organizations/users (unique suffix) and
 * removes them afterwards.
 */
describe('Interview chat (e2e, real database)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const orgSlug = `e2e-chat-${run}`;
  const rivalSlug = `e2e-chat-rival-${run}`;
  const ownerEmail = `chat-owner-${run}@e2e.test`;
  const rivalEmail = `chat-rival-${run}@e2e.test`;
  const aliEmail = `chat-ali-${run}@e2e.test`;
  const jasurEmail = `chat-jasur-${run}@e2e.test`;
  const minhoEmail = `chat-minho-${run}@e2e.test`;
  const PASSWORD = 'CorrectHorseBattery1!';

  let ownerToken: string;
  let rivalToken: string;
  let aliToken: string;
  let jasurToken: string;
  let minhoToken: string;

  let vacancyId: string; // "Backend Engineer" — will be closed
  let vacancySlug: string;
  let survivorVacancyId: string; // second vacancy — must keep its chat
  let survivorSlug: string;

  let aliApplicationId: string;
  let jasurApplicationId: string;
  let minhoApplicationId: string;
  let aliSurvivorApplicationId: string;

  let conversationAliId: string;
  let conversationJasurId: string;
  let conversationSurvivorId: string;

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

    // --- Accounts ---------------------------------------------------------
    const owner = await request(http)
      .post('/auth/register/organization')
      .send({
        organizationName: `E2E Chat ${run}`,
        organizationSlug: orgSlug,
        fullName: 'Chat Owner',
        email: ownerEmail,
        password: PASSWORD,
      })
      .expect(201);
    ownerToken = owner.body.accessToken;

    const rival = await request(http)
      .post('/auth/register/organization')
      .send({
        organizationName: `E2E Chat Rival ${run}`,
        organizationSlug: rivalSlug,
        fullName: 'Rival Owner',
        email: rivalEmail,
        password: PASSWORD,
      })
      .expect(201);
    rivalToken = rival.body.accessToken;

    for (const [email, name] of [
      [aliEmail, 'Ali Candidate'],
      [jasurEmail, 'Jasur Candidate'],
      [minhoEmail, 'Minho Candidate'],
    ] as const) {
      const res = await request(http)
        .post('/auth/register/candidate')
        .send({ fullName: name, email, password: PASSWORD })
        .expect(201);
      if (email === aliEmail) aliToken = res.body.accessToken;
      if (email === jasurEmail) jasurToken = res.body.accessToken;
      if (email === minhoEmail) minhoToken = res.body.accessToken;

      await request(http)
        .post('/candidate-account/me/resume')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .attach('file', PDF, {
          filename: 'e2e-chat-resume.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
    }

    // --- Vacancies --------------------------------------------------------
    const vac = await request(http)
      .post('/vacancies')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Backend Engineer', status: 'OPEN' })
      .expect(201);
    vacancyId = vac.body.id;
    vacancySlug = vac.body.publicSlug;

    const survivor = await request(http)
      .post('/vacancies')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Data Engineer', status: 'OPEN' })
      .expect(201);
    survivorVacancyId = survivor.body.id;
    survivorSlug = survivor.body.publicSlug;

    // --- Lawful pipeline entries (direct applications) --------------------
    const apply = async (token: string, slug: string) => {
      const res = await request(http)
        .post(`/public/jobs/${slug}/apply`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      return res.body.id as string;
    };
    aliApplicationId = await apply(aliToken, vacancySlug);
    jasurApplicationId = await apply(jasurToken, vacancySlug);
    minhoApplicationId = await apply(minhoToken, vacancySlug);
    aliSurvivorApplicationId = await apply(aliToken, survivorSlug);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { slug: { in: [orgSlug, rivalSlug] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [ownerEmail, rivalEmail, aliEmail, jasurEmail, minhoEmail],
        },
      },
    });
    await app.close();
  });

  describe('interview invitation', () => {
    it('creates the conversation and moves the pipeline to INTERVIEW', async () => {
      const res = await request(http)
        .post(`/applications/${aliApplicationId}/invite-interview`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      expect(res.body.conversation.id).toBeTruthy();
      expect(res.body.application.status).toBe('INTERVIEW');
      conversationAliId = res.body.conversation.id;

      const stored = await prisma.application.findUnique({
        where: { id: aliApplicationId },
        select: { status: true },
      });
      expect(stored!.status).toBe('INTERVIEW');
    });

    it('a duplicate invitation returns the SAME conversation — never a second one', async () => {
      const res = await request(http)
        .post(`/applications/${aliApplicationId}/invite-interview`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      expect(res.body.conversation.id).toBe(conversationAliId);
      const count = await prisma.conversation.count({
        where: { vacancyId },
      });
      expect(count).toBe(1);
    });

    it('a second candidate gets their OWN isolated conversation on the same vacancy', async () => {
      const res = await request(http)
        .post(`/applications/${jasurApplicationId}/invite-interview`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      conversationJasurId = res.body.conversation.id;
      expect(conversationJasurId).not.toBe(conversationAliId);

      const list = await request(http)
        .get(`/conversations?vacancyId=${vacancyId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(list.body.meta.total).toBe(2);
    });

    it('an uninvited candidate has no conversation at all', async () => {
      const res = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${minhoToken}`)
        .expect(200);
      expect(res.body.meta.total).toBe(0);
    });

    it('the generic status endpoint cannot bypass conversation creation (INTERVIEW routes through the invitation)', async () => {
      // Deliberately uses PATCH /applications/:id/status, NOT invite-interview.
      const res = await request(http)
        .patch(`/applications/${aliSurvivorApplicationId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'INTERVIEW' })
        .expect(200);
      expect(res.body.status).toBe('INTERVIEW');

      const conversation = await prisma.conversation.findFirst({
        where: { vacancyId: survivorVacancyId },
        select: { id: true },
      });
      expect(conversation).not.toBeNull();
      conversationSurvivorId = conversation!.id;
    });
  });

  describe('messaging', () => {
    it('HR sends to the invited candidate; the candidate reads and replies', async () => {
      await request(http)
        .post(`/conversations/${conversationAliId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Hi Ali — inviting you to interview.' })
        .expect(201);

      const aliView = await request(http)
        .get(
          `/candidate-account/me/conversations/${conversationAliId}/messages`,
        )
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(200);
      expect(aliView.body.data).toHaveLength(1);
      expect(aliView.body.data[0]).toMatchObject({
        senderParty: 'ORGANIZATION',
        senderName: 'Chat Owner',
        content: 'Hi Ali — inviting you to interview.',
      });

      await request(http)
        .post(
          `/candidate-account/me/conversations/${conversationAliId}/messages`,
        )
        .set('Authorization', `Bearer ${aliToken}`)
        .send({ content: 'Thanks! Looking forward to it.' })
        .expect(201);

      const hrView = await request(http)
        .get(`/conversations/${conversationAliId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(hrView.body.data).toHaveLength(2);
      expect(hrView.body.data[1].senderParty).toBe('CANDIDATE');
    });

    it('messages persist in the database (not per-session state)', async () => {
      const count = await prisma.conversationMessage.count({
        where: { conversationId: conversationAliId },
      });
      expect(count).toBe(2);
    });

    it('HR also messages the second candidate; survivor vacancy gets one too', async () => {
      await request(http)
        .post(`/conversations/${conversationJasurId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Hi Jasur — interview slot on Friday?' })
        .expect(201);
      await request(http)
        .post(`/conversations/${conversationSurvivorId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'This one must survive the other vacancy closing.' })
        .expect(201);
    });

    it('a blank message is refused', async () => {
      await request(http)
        .post(`/conversations/${conversationAliId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: '   ' })
        .expect(400);
    });
  });

  describe('isolation', () => {
    it("candidate A cannot read candidate B's conversation or messages (plain 404)", async () => {
      await request(http)
        .get(`/candidate-account/me/conversations/${conversationJasurId}`)
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(404);
      await request(http)
        .get(
          `/candidate-account/me/conversations/${conversationJasurId}/messages`,
        )
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(404);
      await request(http)
        .post(
          `/candidate-account/me/conversations/${conversationJasurId}/messages`,
        )
        .set('Authorization', `Bearer ${aliToken}`)
        .send({ content: 'should never land' })
        .expect(404);
    });

    it('a candidate only ever lists their own conversations', async () => {
      const res = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${jasurToken}`)
        .expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(conversationJasurId);
    });

    it('HR from another organization gets 404 on the conversation and an empty list', async () => {
      await request(http)
        .get(`/conversations/${conversationAliId}`)
        .set('Authorization', `Bearer ${rivalToken}`)
        .expect(404);
      await request(http)
        .post(`/conversations/${conversationAliId}/messages`)
        .set('Authorization', `Bearer ${rivalToken}`)
        .send({ content: 'cross-tenant injection' })
        .expect(404);

      const list = await request(http)
        .get('/conversations')
        .set('Authorization', `Bearer ${rivalToken}`)
        .expect(200);
      expect(list.body.meta.total).toBe(0);
    });

    it('account-type boundaries hold in both directions (403)', async () => {
      // A candidate must not reach org-wide chat administration…
      await request(http)
        .get('/conversations')
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(403);
      // …and an organization account must not impersonate candidate access.
      await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    });

    it('there is no free-form conversation creation endpoint', async () => {
      await request(http)
        .post('/conversations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ vacancyId, candidateAccountId: 'guessed' })
        .expect(404);
    });
  });

  describe('rejection BEFORE interview', () => {
    it('rejects through the existing pipeline and creates NO conversation', async () => {
      const res = await request(http)
        .patch(`/applications/${minhoApplicationId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'REJECTED' })
        .expect(200);
      expect(res.body.status).toBe('REJECTED');

      const list = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${minhoToken}`)
        .expect(200);
      expect(list.body.meta.total).toBe(0);

      const count = await prisma.conversation.count({ where: { vacancyId } });
      expect(count).toBe(2); // still only Ali + Jasur
    });
  });

  describe('rejection AFTER interview — hard-deletes that one chat', () => {
    let deletionEvents: {
      vacancyId: string;
      reason: string;
      conversationIds: string[];
    }[];

    beforeAll(() => {
      // Subscribe to the real event layer of the running app, so the realtime
      // cleanup signal is verified through the actual HTTP path rather than a
      // mock. (The gateway's own room fan-out is unit-tested.)
      deletionEvents = [];
      app
        .get(DomainEventsService)
        .on('chat.conversations.deleted', (payload) =>
          deletionEvents.push(payload as never),
        );
    });

    it('Jasur has a live conversation with messages before the rejection', async () => {
      expect(
        await prisma.conversationMessage.count({
          where: { conversationId: conversationJasurId },
        }),
      ).toBeGreaterThan(0);
    });

    it('rejecting Jasur sets REJECTED and permanently deletes his conversation and messages', async () => {
      const res = await request(http)
        .patch(`/applications/${jasurApplicationId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'REJECTED' })
        .expect(200);
      expect(res.body.status).toBe('REJECTED');

      // Physically gone — not archived, not read-only.
      expect(
        await prisma.conversation.count({
          where: { id: conversationJasurId },
        }),
      ).toBe(0);
      expect(
        await prisma.conversationMessage.count({
          where: { conversationId: conversationJasurId },
        }),
      ).toBe(0);
    });

    it('emits the chat deletion event with reason CANDIDATE_REJECTED for exactly that conversation', () => {
      const event = deletionEvents.find((e) =>
        e.conversationIds.includes(conversationJasurId),
      );
      expect(event).toBeDefined();
      expect(event!.reason).toBe('CANDIDATE_REJECTED');
      expect(event!.conversationIds).toEqual([conversationJasurId]);
      expect(event!.vacancyId).toBe(vacancyId);
    });

    it('the rejected candidate can no longer read or send (normal 404)', async () => {
      await request(http)
        .get(`/candidate-account/me/conversations/${conversationJasurId}`)
        .set('Authorization', `Bearer ${jasurToken}`)
        .expect(404);
      await request(http)
        .get(
          `/candidate-account/me/conversations/${conversationJasurId}/messages`,
        )
        .set('Authorization', `Bearer ${jasurToken}`)
        .expect(404);
      await request(http)
        .post(
          `/candidate-account/me/conversations/${conversationJasurId}/messages`,
        )
        .set('Authorization', `Bearer ${jasurToken}`)
        .send({ content: 'after rejection' })
        .expect(404);

      const list = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${jasurToken}`)
        .expect(200);
      expect(list.body.meta.total).toBe(0);
    });

    it('HR can no longer read or send in the deleted chat either', async () => {
      await request(http)
        .get(`/conversations/${conversationJasurId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      await request(http)
        .get(`/conversations/${conversationJasurId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      await request(http)
        .post(`/conversations/${conversationJasurId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'after rejection' })
        .expect(404);
    });

    it('candidate A on the SAME vacancy keeps their conversation and messages', async () => {
      const messages = await request(http)
        .get(`/conversations/${conversationAliId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(messages.body.data).toHaveLength(2);

      const aliSees = await request(http)
        .get(`/candidate-account/me/conversations/${conversationAliId}`)
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(200);
      expect(aliSees.body.id).toBe(conversationAliId);

      // Exactly one conversation was removed from this vacancy.
      expect(await prisma.conversation.count({ where: { vacancyId } })).toBe(1);
    });

    it('the unrelated vacancy is untouched by the rejection', async () => {
      expect(
        await prisma.conversation.count({
          where: { vacancyId: survivorVacancyId },
        }),
      ).toBe(1);
      const messages = await request(http)
        .get(`/conversations/${conversationSurvivorId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(messages.body.data).toHaveLength(1);
    });

    it('re-inviting the rejected candidate opens a FRESH empty conversation', async () => {
      const res = await request(http)
        .post(`/applications/${jasurApplicationId}/invite-interview`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      // A new row — the deleted transcript never comes back.
      expect(res.body.conversation.id).not.toBe(conversationJasurId);
      conversationJasurId = res.body.conversation.id;

      const messages = await request(http)
        .get(`/conversations/${conversationJasurId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(messages.body.data).toHaveLength(0);
    });
  });

  describe('application deletion — takes its chat with it', () => {
    let deletionEvents: {
      vacancyId: string;
      reason: string;
      conversationIds: string[];
    }[];

    beforeAll(async () => {
      deletionEvents = [];
      app
        .get(DomainEventsService)
        .on('chat.conversations.deleted', (payload) =>
          deletionEvents.push(payload as never),
        );

      // Both candidates hold a live chat on this vacancy, each with messages,
      // and Ali additionally holds one on the OTHER vacancy.
      await request(http)
        .post(`/conversations/${conversationJasurId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'Jasur — rescheduling your interview.' })
        .expect(201);
    });

    it('starts from two live chats on this vacancy plus one elsewhere', async () => {
      expect(await prisma.conversation.count({ where: { vacancyId } })).toBe(2);
      expect(
        await prisma.conversationMessage.count({
          where: { conversationId: conversationAliId },
        }),
      ).toBe(2);
      expect(
        await prisma.conversationMessage.count({
          where: { conversationId: conversationJasurId },
        }),
      ).toBe(1);
    });

    it('deleting the application permanently deletes its conversation and messages', async () => {
      await request(http)
        .delete(`/applications/${aliApplicationId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(
        await prisma.application.count({ where: { id: aliApplicationId } }),
      ).toBe(0);
      expect(
        await prisma.conversation.count({ where: { id: conversationAliId } }),
      ).toBe(0);
      expect(
        await prisma.conversationMessage.count({
          where: { conversationId: conversationAliId },
        }),
      ).toBe(0);
    });

    it('emits the deletion event with reason APPLICATION_DELETED, for that conversation only', () => {
      const event = deletionEvents.find((e) =>
        e.conversationIds.includes(conversationAliId),
      );
      expect(event).toBeDefined();
      expect(event!.reason).toBe('APPLICATION_DELETED');
      expect(event!.conversationIds).toEqual([conversationAliId]);
      expect(event!.vacancyId).toBe(vacancyId);
    });

    it('HR can no longer read or send in the deleted chat', async () => {
      await request(http)
        .get(`/conversations/${conversationAliId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      await request(http)
        .get(`/conversations/${conversationAliId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      await request(http)
        .post(`/conversations/${conversationAliId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'after deletion' })
        .expect(404);
    });

    it('the candidate can no longer read or send either', async () => {
      await request(http)
        .get(`/candidate-account/me/conversations/${conversationAliId}`)
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(404);
      await request(http)
        .post(
          `/candidate-account/me/conversations/${conversationAliId}/messages`,
        )
        .set('Authorization', `Bearer ${aliToken}`)
        .send({ content: 'after deletion' })
        .expect(404);
    });

    it("candidate B's chat on the SAME vacancy is untouched", async () => {
      const messages = await request(http)
        .get(`/conversations/${conversationJasurId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(messages.body.data).toHaveLength(1);

      const jasurSees = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${jasurToken}`)
        .expect(200);
      expect(jasurSees.body.meta.total).toBe(1);
      expect(jasurSees.body.data[0].id).toBe(conversationJasurId);
    });

    it("the same candidate's chat on ANOTHER vacancy is untouched", async () => {
      const aliSees = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(200);
      expect(aliSees.body.meta.total).toBe(1);
      expect(aliSees.body.data[0].id).toBe(conversationSurvivorId);

      const messages = await request(http)
        .get(`/conversations/${conversationSurvivorId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(messages.body.data).toHaveLength(1);
    });

    it('deleting an application that never reached interview succeeds with no chat', async () => {
      // Minho was rejected before any interview, so he has no conversation.
      const before = deletionEvents.length;
      await request(http)
        .delete(`/applications/${minhoApplicationId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(
        await prisma.application.count({ where: { id: minhoApplicationId } }),
      ).toBe(0);
      // Nothing existed to delete, so nothing was announced.
      expect(deletionEvents).toHaveLength(before);
    });

    it("a foreign organization cannot delete this organization's application", async () => {
      await request(http)
        .delete(`/applications/${jasurApplicationId}`)
        .set('Authorization', `Bearer ${rivalToken}`)
        .expect(404);
      expect(
        await prisma.conversation.count({ where: { id: conversationJasurId } }),
      ).toBe(1);
    });
  });

  describe('no accountless candidate can reach the interview flow', () => {
    it('a directly-inserted accountless candidate is invisible to the pipeline API', async () => {
      // The product can no longer produce this row (recruiter-created
      // candidates were removed); one is inserted here to prove the leftovers
      // of that feature cannot be invited, chatted with, or even read.
      const org = await prisma.organization.findUniqueOrThrow({
        where: { slug: orgSlug },
        select: { id: true },
      });
      const orphan = await prisma.candidate.create({
        data: {
          organizationId: org.id,
          fullName: 'External Elena',
          email: `elena-${run}@ext.test`,
        },
        select: { id: true },
      });
      const association = await prisma.application.create({
        data: {
          vacancyId,
          candidateId: orphan.id,
          source: 'MANUAL_UPLOAD',
        },
        select: { id: true },
      });

      await request(http)
        .post(`/applications/${association.id}/invite-interview`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      await request(http)
        .get(`/applications/${association.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      await request(http)
        .get(`/candidates/${orphan.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      // No conversation was fabricated for them anywhere.
      expect(
        await prisma.conversation.count({
          where: { vacancyId, candidateId: orphan.id },
        }),
      ).toBe(0);
    });
  });

  describe('vacancy close — permanent deletion', () => {
    it('closing the vacancy deletes ALL its conversations and messages for BOTH sides', async () => {
      const closed = await request(http)
        .patch(`/vacancies/${vacancyId}/close`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(closed.body.status).toBe('CLOSED');

      // Physically gone — not hidden, not archived.
      expect(await prisma.conversation.count({ where: { vacancyId } })).toBe(0);
      expect(
        await prisma.conversationMessage.count({
          where: {
            conversationId: { in: [conversationAliId, conversationJasurId] },
          },
        }),
      ).toBe(0);

      // HR no longer sees them.
      const hrList = await request(http)
        .get(`/conversations?vacancyId=${vacancyId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(hrList.body.meta.total).toBe(0);
      await request(http)
        .get(`/conversations/${conversationAliId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      // Candidates no longer see them either.
      await request(http)
        .get(`/candidate-account/me/conversations/${conversationAliId}`)
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(404);
      const jasurList = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${jasurToken}`)
        .expect(200);
      expect(jasurList.body.meta.total).toBe(0);
    });

    it("the other vacancy's conversation and messages survive untouched", async () => {
      const aliList = await request(http)
        .get('/candidate-account/me/conversations')
        .set('Authorization', `Bearer ${aliToken}`)
        .expect(200);
      expect(aliList.body.meta.total).toBe(1);
      expect(aliList.body.data[0].id).toBe(conversationSurvivorId);

      const messages = await request(http)
        .get(`/conversations/${conversationSurvivorId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(messages.body.data).toHaveLength(1);
      expect(messages.body.data[0].content).toBe(
        'This one must survive the other vacancy closing.',
      );
    });

    it('no new invitation can spawn a chat on the closed vacancy', async () => {
      await request(http)
        .post(`/applications/${jasurApplicationId}/invite-interview`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
    });

    it('sending into a deleted conversation is a plain 404 for both sides', async () => {
      await request(http)
        .post(`/conversations/${conversationAliId}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'ghost message' })
        .expect(404);
      await request(http)
        .post(
          `/candidate-account/me/conversations/${conversationAliId}/messages`,
        )
        .set('Authorization', `Bearer ${aliToken}`)
        .send({ content: 'ghost reply' })
        .expect(404);
    });
  });
});
