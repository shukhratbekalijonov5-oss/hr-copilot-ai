import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The notification system end to end (real database + Redis): business
 * actions over real HTTP → persisted notifications → recipient-scoped API.
 *
 * Covers the §72 matrix: creator-only NEW_APPLICATION (Bob, same org, gets
 * nothing), manual-add silence, both chat directions without sender
 * self-noise, transition-gated invitation and rejection (with duplicate
 * suppression), vacancy delete with title snapshots surviving the deleted
 * rows, all-or-nothing bulk-delete producing nothing on failure, and the
 * cross-user read/mark walls.
 */
describe('Notifications (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const orgSlug = `e2e-notif-${run}`;
  const aliceEmail = `notif-alice-${run}@e2e.test`;
  const bobEmail = `notif-bob-${run}@e2e.test`;
  const johnEmail = `notif-john-${run}@e2e.test`;
  const otherEmail = `notif-other-${run}@e2e.test`;
  const PASSWORD = 'CorrectHorseBattery1!';

  let aliceToken: string;
  let bobToken: string;
  let johnToken: string;
  let otherToken: string;

  let backendVacancyId: string; // "Backend Engineer" — chat + delete flows
  let devopsVacancyId: string; // "DevOps Engineer" — rejection flow
  let backendSlug: string;
  let devopsSlug: string;
  let johnCandidateId: string;
  let johnApplicationId: string; // on Backend Engineer
  let conversationId: string;

  const PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );

  /** Event handlers are fire-and-forget; poll briefly for the row to land. */
  const eventually = async <T>(
    read: () => Promise<T>,
    ok: (value: T) => boolean,
  ): Promise<T> => {
    let last: T = await read();
    for (let i = 0; i < 40 && !ok(last); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      last = await read();
    }
    return last;
  };

  const myNotifications = async (token: string) => {
    const res = await request(http)
      .get('/notifications?limit=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data as {
      id: string;
      type: string;
      audience: string;
      isRead: boolean;
      vacancy: { id: string; title: string; deleted: boolean } | null;
      candidate: { id: string; name: string } | null;
      actor: { name: string } | null;
      conversationId: string | null;
      messagePreview: string | null;
    }[];
  };
  const unread = async (token: string) => {
    const res = await request(http)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.unread as number;
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

    const alice = await request(http).post('/auth/register/organization').send({
      organizationName: 'E2E Notif Org',
      organizationSlug: orgSlug,
      fullName: 'Alice Park',
      email: aliceEmail,
      password: PASSWORD,
    });
    aliceToken = alice.body.accessToken;

    await request(http)
      .post('/auth/users')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        fullName: 'Bob Lee',
        email: bobEmail,
        password: PASSWORD,
        role: 'HR_ADMIN',
      })
      .expect(201);
    bobToken = (
      await request(http)
        .post('/auth/login')
        .send({ email: bobEmail, password: PASSWORD })
    ).body.accessToken;

    johnToken = (
      await request(http).post('/auth/register/candidate').send({
        fullName: 'John Kim',
        email: johnEmail,
        password: PASSWORD,
      })
    ).body.accessToken;
    otherToken = (
      await request(http).post('/auth/register/candidate').send({
        fullName: 'Other Person',
        email: otherEmail,
        password: PASSWORD,
      })
    ).body.accessToken;

    const mkVacancy = async (title: string) => {
      const res = await request(http)
        .post('/vacancies')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ title, status: 'OPEN' })
        .expect(201);
      return res.body as { id: string; publicSlug: string };
    };
    const backend = await mkVacancy('Backend Engineer');
    backendVacancyId = backend.id;
    backendSlug = backend.publicSlug;
    const devops = await mkVacancy('DevOps Engineer');
    devopsVacancyId = devops.id;
    devopsSlug = devops.publicSlug;

    await request(http)
      .post('/candidate-account/me/resume')
      .set('Authorization', `Bearer ${johnToken}`)
      .attach('file', PDF, {
        filename: 'john.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
  });

  afterAll(async () => {
    const users = [aliceEmail, bobEmail, johnEmail, otherEmail];
    await prisma.notification.deleteMany({
      where: { recipient: { email: { in: users } } },
    });
    await prisma.organization.deleteMany({ where: { slug: orgSlug } });
    await prisma.user.deleteMany({ where: { email: { in: users } } });
    await app.close();
  });

  describe('NEW_APPLICATION — creator only', () => {
    it('John applying notifies Alice with his name and the vacancy; Bob gets nothing', async () => {
      await request(http)
        .post(`/public/jobs/${backendSlug}/apply`)
        .set('Authorization', `Bearer ${johnToken}`)
        .expect(201);
      await request(http)
        .post(`/public/jobs/${devopsSlug}/apply`)
        .set('Authorization', `Bearer ${johnToken}`)
        .expect(201);

      const rows = await eventually(
        () => myNotifications(aliceToken),
        (r) => r.filter((n) => n.type === 'NEW_APPLICATION').length >= 2,
      );
      const applications = rows.filter((n) => n.type === 'NEW_APPLICATION');
      expect(applications).toHaveLength(2);
      const backendRow = applications.find(
        (n) => n.vacancy?.id === backendVacancyId,
      )!;
      expect(backendRow.audience).toBe('HR');
      expect(backendRow.candidate?.name).toBe('John Kim');
      expect(backendRow.vacancy?.title).toBe('Backend Engineer');
      expect(backendRow.isRead).toBe(false);

      expect(await unread(bobToken)).toBe(0);

      johnCandidateId = backendRow.candidate!.id;
      const application = await prisma.application.findFirstOrThrow({
        where: {
          vacancyId: backendVacancyId,
          candidateId: johnCandidateId,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      johnApplicationId = application.id;
    });

    it('there is no recruiter-side way to add a candidate and self-notify', async () => {
      const before = (await myNotifications(aliceToken)).length;
      // Both removed routes answer 404 — nothing to notify about.
      await request(http)
        .post('/candidates')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ vacancyId: backendVacancyId, fullName: 'Manual Max' })
        .expect(404);
      await request(http)
        .post('/applications')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ vacancyId: backendVacancyId, candidateId: johnCandidateId })
        .expect(404);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await myNotifications(aliceToken)).length).toBe(before);
    });
  });

  describe('INTERVIEW_INVITATION — transition-gated', () => {
    it('inviting John notifies him with Alice name and the vacancy', async () => {
      const res = await request(http)
        .post(`/applications/${johnApplicationId}/invite-interview`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(201);
      conversationId = res.body.conversation.id;

      const rows = await eventually(
        () => myNotifications(johnToken),
        (r) => r.some((n) => n.type === 'INTERVIEW_INVITATION'),
      );
      const invite = rows.find((n) => n.type === 'INTERVIEW_INVITATION')!;
      expect(invite.audience).toBe('CANDIDATE');
      expect(invite.actor?.name).toBe('Alice Park');
      expect(invite.vacancy?.title).toBe('Backend Engineer');
      expect(invite.conversationId).toBe(conversationId);
    });

    it('a re-invite does not duplicate the notification', async () => {
      await request(http)
        .post(`/applications/${johnApplicationId}/invite-interview`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 400));
      const invites = (await myNotifications(johnToken)).filter(
        (n) => n.type === 'INTERVIEW_INVITATION',
      );
      expect(invites).toHaveLength(1);
    });
  });

  describe('NEW_MESSAGE — both directions, never the sender', () => {
    it('John → Alice: Alice sees name/vacancy/preview; John and Bob see nothing', async () => {
      await request(http)
        .post(`/candidate-account/me/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${johnToken}`)
        .send({ content: 'Hello, can I ask about the interview?' })
        .expect(201);

      const rows = await eventually(
        () => myNotifications(aliceToken),
        (r) => r.some((n) => n.type === 'NEW_MESSAGE'),
      );
      const msg = rows.find((n) => n.type === 'NEW_MESSAGE')!;
      expect(msg.audience).toBe('HR');
      expect(msg.candidate?.name).toBe('John Kim');
      expect(msg.vacancy?.title).toBe('Backend Engineer');
      expect(msg.messagePreview).toBe('Hello, can I ask about the interview?');
      expect(msg.conversationId).toBe(conversationId);

      expect(
        (await myNotifications(johnToken)).filter(
          (n) => n.type === 'NEW_MESSAGE',
        ),
      ).toHaveLength(0);
      expect(await unread(bobToken)).toBe(0);
    });

    it('Alice → John: John sees her name/vacancy/preview; Alice gets no echo', async () => {
      const aliceBefore = (await myNotifications(aliceToken)).filter(
        (n) => n.type === 'NEW_MESSAGE',
      ).length;

      await request(http)
        .post(`/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ content: 'Your interview is tomorrow.' })
        .expect(201);

      const rows = await eventually(
        () => myNotifications(johnToken),
        (r) => r.some((n) => n.type === 'NEW_MESSAGE'),
      );
      const msg = rows.find((n) => n.type === 'NEW_MESSAGE')!;
      expect(msg.audience).toBe('CANDIDATE');
      expect(msg.actor?.name).toBe('Alice Park');
      expect(msg.vacancy?.title).toBe('Backend Engineer');
      expect(msg.messagePreview).toBe('Your interview is tomorrow.');

      expect(
        (await myNotifications(aliceToken)).filter(
          (n) => n.type === 'NEW_MESSAGE',
        ),
      ).toHaveLength(aliceBefore);
    });
  });

  describe('APPLICATION_REJECTED — genuine transitions only', () => {
    let devopsApplicationId: string;

    beforeAll(async () => {
      const application = await prisma.application.findFirstOrThrow({
        where: {
          vacancyId: devopsVacancyId,
          candidateId: johnCandidateId,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      devopsApplicationId = application.id;
    });

    it('rejecting John on DevOps notifies him with that vacancy name', async () => {
      await request(http)
        .patch(`/applications/${devopsApplicationId}/status`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ status: 'REJECTED' })
        .expect(200);

      const rows = await eventually(
        () => myNotifications(johnToken),
        (r) => r.some((n) => n.type === 'APPLICATION_REJECTED'),
      );
      const rejection = rows.find((n) => n.type === 'APPLICATION_REJECTED')!;
      expect(rejection.vacancy?.title).toBe('DevOps Engineer');
      expect(rejection.audience).toBe('CANDIDATE');
    });

    it('REJECTED → REJECTED does not notify again', async () => {
      await request(http)
        .patch(`/applications/${devopsApplicationId}/status`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ status: 'REJECTED' })
        .expect(200);

      await new Promise((resolve) => setTimeout(resolve, 400));
      const rejections = (await myNotifications(johnToken)).filter(
        (n) => n.type === 'APPLICATION_REJECTED',
      );
      expect(rejections).toHaveLength(1);
    });
  });

  describe('read state + cross-user walls', () => {
    it('mark one read, then mark all read — counts follow', async () => {
      const before = await unread(johnToken);
      expect(before).toBeGreaterThan(0);
      const rows = await myNotifications(johnToken);
      const target = rows.find((n) => !n.isRead)!;

      const marked = await request(http)
        .patch(`/notifications/${target.id}/read`)
        .set('Authorization', `Bearer ${johnToken}`)
        .expect(200);
      expect(marked.body.isRead).toBe(true);
      expect(await unread(johnToken)).toBe(before - 1);

      await request(http)
        .post('/notifications/read-all')
        .set('Authorization', `Bearer ${johnToken}`)
        .expect(200);
      expect(await unread(johnToken)).toBe(0);
    });

    it("Bob cannot read or mark Alice's notification; candidates cannot cross either", async () => {
      const aliceRow = (await myNotifications(aliceToken))[0];
      await request(http)
        .patch(`/notifications/${aliceRow.id}/read`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(404);
      await request(http)
        .patch(`/notifications/${aliceRow.id}/read`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);

      const johnRow = (await myNotifications(johnToken))[0];
      await request(http)
        .patch(`/notifications/${johnRow.id}/read`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
      expect(await myNotifications(otherToken)).toHaveLength(0);
    });

    it('no endpoint accepts a client-chosen recipient (no create surface at all)', async () => {
      await request(http)
        .post('/notifications')
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ recipientUserId: 'someone-else', type: 'NEW_MESSAGE' })
        .expect(404);
    });
  });

  describe('VACANCY_DELETED — snapshots outlive the rows', () => {
    it('a failed (mixed-ownership) bulk delete produces NO notifications', async () => {
      const bobVacancy = await request(http)
        .post('/vacancies')
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ title: 'Bob Own Role' })
        .expect(201);

      await request(http)
        .post('/vacancies/bulk-delete')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ vacancyIds: [backendVacancyId, bobVacancy.body.id] })
        .expect(403);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(
        (await myNotifications(johnToken)).filter(
          (n) => n.type === 'VACANCY_DELETED',
        ),
      ).toHaveLength(0);
    });

    it('bulk-deleting both vacancies notifies John once PER vacancy, titles preserved', async () => {
      await request(http)
        .post('/vacancies/bulk-delete')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ vacancyIds: [backendVacancyId, devopsVacancyId] })
        .expect(200);

      const rows = await eventually(
        () => myNotifications(johnToken),
        (r) => r.filter((n) => n.type === 'VACANCY_DELETED').length >= 2,
      );
      const deletions = rows.filter((n) => n.type === 'VACANCY_DELETED');
      expect(deletions).toHaveLength(2);
      expect(deletions.map((n) => n.vacancy?.title).sort()).toEqual([
        'Backend Engineer',
        'DevOps Engineer',
      ]);
      for (const deletion of deletions) {
        expect(deletion.vacancy?.deleted).toBe(true);
        expect(deletion.audience).toBe('CANDIDATE');
      }

      // The vacancy rows are genuinely gone; the notification stands alone.
      expect(
        await prisma.vacancy.count({
          where: { id: { in: [backendVacancyId, devopsVacancyId] } },
        }),
      ).toBe(0);
    });
  });
});
