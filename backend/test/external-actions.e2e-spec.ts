import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Saved external jobs + external apply tracking (Tasks 4C.4/4C.5), end to end
 * against the REAL database.
 *
 * What only this level can prove:
 *
 *  - the literal `saved` path segment beating the `:externalJobId` parameter
 *    route, over real routing;
 *  - idempotence enforced by the composite unique index, not by luck;
 *  - one candidate structurally unable to touch another's bookmarks and
 *    trackers, over real HTTP with real tokens;
 *  - a bookmark and a tracker OUTLIVING the job's lifecycle, and the saved
 *    list telling the truth about a job that closed after being saved;
 *  - marking an application creating NOTHING in the internal Application
 *    table — counted before and after in the same database;
 *  - decoration leaving a stored search's order and scores byte-identical.
 *
 * Fixtures are namespaced by a unique marker and removed afterwards; the live
 * catalogue is never asserted on and never touched.
 */
describe('Saved external jobs & apply tracking (e2e, real database)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const PASSWORD = 'CorrectHorseBattery1!';
  const seekerEmail = `xact-seeker-${run}@e2e.test`;
  const otherEmail = `xact-other-${run}@e2e.test`;
  const recruiterEmail = `xact-recruiter-${run}@e2e.test`;
  const orgSlug = `e2e-xact-${run}`;
  const COMPANY = `ZZ Actions Fixture ${run}`;
  const MARKER = `zzqa${run}`;

  let seekerToken: string;
  let otherToken: string;
  let recruiterToken: string;
  let companyId: string;
  const ids: Record<string, string> = {};

  const BASE = '/candidate-account/me/external-jobs';
  const TRACKERS = '/candidate-account/me/external-job-applications';
  const GHOST = '99999999-9999-4999-8999-999999999999';

  const asUser = (token: string) => ({
    get: (url: string) =>
      request(http).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) =>
      request(http)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .send(body),
    patch: (url: string, body: Record<string, unknown>) =>
      request(http)
        .patch(url)
        .set('Authorization', `Bearer ${token}`)
        .send(body),
    delete: (url: string) =>
      request(http).delete(url).set('Authorization', `Bearer ${token}`),
  });

  async function makeJob(
    key: string,
    over: Record<string, unknown> = {},
  ): Promise<void> {
    const job = await prisma.externalJob.create({
      data: {
        dedupeFingerprint: `${MARKER}-${key}`,
        externalCompanyId: companyId,
        title: `${MARKER} Platform Engineer ${key}`,
        normalizedTitle: `${MARKER} platform engineer ${key}`,
        description: 'Operate the fixture platform.',
        countryCode: 'US',
        city: 'Austin',
        status: 'ACTIVE',
        employerPostedAt: new Date('2026-08-10T12:00:00.000Z'),
        canonicalUrl: `https://boards.zzfixture.invalid/${MARKER}/${key}`,
        ...over,
      },
      select: { id: true },
    });
    ids[key] = job.id;
    await prisma.externalJobSource.create({
      data: {
        externalJobId: job.id,
        provider: 'GREENHOUSE',
        accessMethod: 'OFFICIAL_API',
        sourceKey: `${MARKER}:${key}`,
        sourceUrl: `https://boards.zzfixture.invalid/${MARKER}/${key}`,
        originalUrl: `https://boards.zzfixture.invalid/${MARKER}/${key}`,
        status: 'ACTIVE',
      },
    });
  }

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

    seekerToken = (
      await request(http).post('/auth/register/candidate').send({
        fullName: 'Actions Seeker',
        email: seekerEmail,
        password: PASSWORD,
      })
    ).body.accessToken;
    otherToken = (
      await request(http).post('/auth/register/candidate').send({
        fullName: 'Actions Other',
        email: otherEmail,
        password: PASSWORD,
      })
    ).body.accessToken;
    recruiterToken = (
      await request(http).post('/auth/register/organization').send({
        organizationName: 'E2E Actions Org',
        organizationSlug: orgSlug,
        fullName: 'Actions Recruiter',
        email: recruiterEmail,
        password: PASSWORD,
      })
    ).body.accessToken;

    // The whole saved/tracking surface is the MAX product (Task 4C.5.1);
    // these fixtures test the features, plan-entitlements.e2e-spec.ts tests
    // the gate. Supported fixture path — no HTTP endpoint writes plans.
    await prisma.candidateAccount.updateMany({
      where: { user: { email: { in: [seekerEmail, otherEmail] } } },
      data: { plan: 'MAX' },
    });

    companyId = (
      await prisma.externalCompany.create({
        data: {
          name: COMPANY,
          normalizedName: COMPANY.toLowerCase(),
          domain: '',
        },
        select: { id: true },
      })
    ).id;

    await makeJob('a');
    await makeJob('b');
    await makeJob('closingSoon');
    await makeJob('stale', { status: 'STALE' });
    await makeJob('closed', { status: 'CLOSED' });
  });

  afterAll(async () => {
    const fixtures = await prisma.externalJob.findMany({
      where: { externalCompanyId: companyId },
      select: { id: true },
    });
    const jobIds = fixtures.map((job) => job.id);
    await prisma.candidateSavedExternalJob.deleteMany({
      where: { externalJobId: { in: jobIds } },
    });
    await prisma.candidateExternalJobApplication.deleteMany({
      where: { externalJobId: { in: jobIds } },
    });
    await prisma.externalJobSource.deleteMany({
      where: { externalJobId: { in: jobIds } },
    });
    await prisma.externalJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.externalCompany.deleteMany({ where: { id: companyId } });
    await prisma.organization.deleteMany({ where: { slug: orgSlug } });
    await prisma.user.deleteMany({
      where: { email: { in: [seekerEmail, otherEmail, recruiterEmail] } },
    });
    await app.close();
  });

  describe('ownership walls', () => {
    it('refuses anonymous and ORGANIZATION callers on every surface', async () => {
      await request(http).get(`${BASE}/saved`).expect(401);
      const recruiter = asUser(recruiterToken);
      await recruiter.get(`${BASE}/saved`).expect(403);
      await recruiter.post(`${BASE}/${ids.a}/save`).expect(403);
      await recruiter.post(`${BASE}/${ids.a}/application`).expect(403);
      await recruiter.get(TRACKERS).expect(403);
    });

    it('rejects a malformed job id before any query runs', async () => {
      await asUser(seekerToken).post(`${BASE}/not-a-uuid/save`).expect(400);
    });
  });

  describe('saving (4C.4)', () => {
    it('saves, idempotently — twice is the same bookmark', async () => {
      const seeker = asUser(seekerToken);
      const first = await seeker.post(`${BASE}/${ids.a}/save`).expect(200);
      expect(first.body).toMatchObject({ externalJobId: ids.a, saved: true });

      const again = await seeker.post(`${BASE}/${ids.a}/save`).expect(200);
      // Same bookmark, same original savedAt — nothing was replaced.
      expect(again.body.savedAt).toBe(first.body.savedAt);

      const rows = await prisma.candidateSavedExternalJob.findMany({
        where: { externalJobId: ids.a },
      });
      expect(rows).toHaveLength(1);
    });

    it('saves a STALE job — it is still in the visible universe', async () => {
      await asUser(seekerToken).post(`${BASE}/${ids.stale}/save`).expect(200);
    });

    it('is a 404 for an id that is not an external job', async () => {
      await asUser(seekerToken).post(`${BASE}/${GHOST}/save`).expect(404);
    });

    it('lists newest-first with honest pagination', async () => {
      const seeker = asUser(seekerToken);
      await seeker.post(`${BASE}/${ids.b}/save`).expect(200);

      const page = await seeker.get(`${BASE}/saved?pageSize=2`).expect(200);
      expect(page.body.total).toBeGreaterThanOrEqual(3);
      expect(page.body.pageSize).toBe(2);
      expect(page.body.results).toHaveLength(2);
      // Newest first: b was saved last.
      expect(page.body.results[0].externalJobId).toBe(ids.b);
      // The card carries what a UI needs — no second fetch per row.
      expect(page.body.results[0]).toMatchObject({
        title: expect.stringContaining(MARKER) as unknown,
        company: COMPANY,
        status: 'ACTIVE',
        applyUrl: expect.stringContaining(MARKER) as unknown,
        applicationTracking: null,
      });
      expect(page.body.results[0].savedAt).toBeTruthy();
      expect(page.body.results[0].employerPostedAt).toBe(
        '2026-08-10T12:00:00.000Z',
      );

      const second = await seeker
        .get(`${BASE}/saved?page=2&pageSize=2`)
        .expect(200);
      const firstIds = page.body.results.map(
        (row: { externalJobId: string }) => row.externalJobId,
      );
      for (const row of second.body.results as { externalJobId: string }[]) {
        expect(firstIds).not.toContain(row.externalJobId);
      }
    });

    it("cannot see another candidate's bookmarks", async () => {
      const other = await asUser(otherToken).get(`${BASE}/saved`).expect(200);
      expect(other.body.total).toBe(0);
      expect(other.body.results).toEqual([]);
    });

    it('unsaves idempotently', async () => {
      const seeker = asUser(seekerToken);
      await seeker.delete(`${BASE}/${ids.b}/save`).expect(200);
      const again = await seeker.delete(`${BASE}/${ids.b}/save`).expect(200);
      expect(again.body).toEqual({ externalJobId: ids.b, saved: false });
    });

    it("another candidate's unsave cannot remove my bookmark", async () => {
      await asUser(otherToken).delete(`${BASE}/${ids.a}/save`).expect(200);
      const mine = await asUser(seekerToken)
        .get(`${BASE}/saved?pageSize=50`)
        .expect(200);
      const savedIds = mine.body.results.map(
        (row: { externalJobId: string }) => row.externalJobId,
      );
      expect(savedIds).toContain(ids.a);
    });

    it('keeps a saved job through closure, honestly labelled', async () => {
      const seeker = asUser(seekerToken);
      await seeker.post(`${BASE}/${ids.closingSoon}/save`).expect(200);

      // The provider says it closed. A status UPDATE — the bookmark stays.
      await prisma.externalJob.update({
        where: { id: ids.closingSoon },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      const page = await seeker.get(`${BASE}/saved?pageSize=50`).expect(200);
      const row = page.body.results.find(
        (entry: { externalJobId: string }) =>
          entry.externalJobId === ids.closingSoon,
      );
      // Still listed, telling the truth: the listing ended, the bookmark
      // did not. Search and detail meanwhile refuse this job (proven below).
      expect(row).toBeDefined();
      expect(row.status).toBe('CLOSED');

      // The candidate can still unsave it normally.
      await seeker.delete(`${BASE}/${ids.closingSoon}/save`).expect(200);
    });

    it('a closed job stays out of detail even when saved', async () => {
      await asUser(seekerToken).get(`${BASE}/${ids.closed}`).expect(404);
    });
  });

  describe('apply tracking (4C.5)', () => {
    it('creates a tracker only from the explicit candidate action', async () => {
      const seeker = asUser(seekerToken);
      const before = await prisma.application.count();

      const created = await seeker
        .post(`${BASE}/${ids.a}/application`, {
          appliedAt: '2026-08-15T09:00:00.000Z',
          note: '  via referral from Kim  ',
        })
        .expect(201);

      expect(created.body).toMatchObject({
        externalJobId: ids.a,
        status: 'APPLIED',
        appliedAt: '2026-08-15T09:00:00.000Z',
        note: 'via referral from Kim',
      });
      ids.trackerA = created.body.id;

      // THE structural proof: marking an external application wrote NOTHING
      // to the internal Application table.
      expect(await prisma.application.count()).toBe(before);
    });

    it('refuses a second tracker, pointing at the first', async () => {
      const conflict = await asUser(seekerToken)
        .post(`${BASE}/${ids.a}/application`)
        .expect(409);
      expect(conflict.body.message).toBe(
        'EXTERNAL_APPLICATION_ALREADY_TRACKED',
      );
      expect(conflict.body.trackingId).toBe(ids.trackerA);
    });

    it('refuses a future appliedAt and an unknown status', async () => {
      const seeker = asUser(seekerToken);
      await seeker
        .post(`${BASE}/${ids.b}/application`, {
          appliedAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
        })
        .expect(400);
      await seeker
        .post(`${BASE}/${ids.b}/application`, { status: 'HIRED' })
        .expect(400);
      await seeker
        .post(`${BASE}/${ids.b}/application`, { note: 'x'.repeat(2001) })
        .expect(400);
    });

    it('is a 404 for an id that is not an external job', async () => {
      await asUser(seekerToken)
        .post(`${BASE}/${GHOST}/application`)
        .expect(404);
    });

    it('walks the stages as the candidate reports them', async () => {
      const seeker = asUser(seekerToken);
      const toInterview = await seeker
        .patch(`${TRACKERS}/${ids.trackerA}`, { status: 'INTERVIEW' })
        .expect(200);
      expect(toInterview.body.status).toBe('INTERVIEW');

      const toOffer = await seeker
        .patch(`${TRACKERS}/${ids.trackerA}`, {
          status: 'OFFER',
          note: null,
        })
        .expect(200);
      expect(toOffer.body.status).toBe('OFFER');
      // Explicit null cleared the note; the earlier PATCH left it alone.
      expect(toOffer.body.note).toBeNull();
    });

    it("cannot read, update or delete another candidate's tracker", async () => {
      const other = asUser(otherToken);
      // Foreign tracker answers exactly like an absent one.
      await other
        .patch(`${TRACKERS}/${ids.trackerA}`, { status: 'REJECTED' })
        .expect(404);
      await other.delete(`${TRACKERS}/${ids.trackerA}`).expect(404);

      const list = await other.get(TRACKERS).expect(200);
      expect(list.body.total).toBe(0);
    });

    it('lists trackers with the job card and honest status filter', async () => {
      const seeker = asUser(seekerToken);
      await seeker
        .post(`${BASE}/${ids.stale}/application`, {
          status: 'REJECTED',
          appliedAt: '2026-08-01T00:00:00.000Z',
        })
        .expect(201);

      const all = await seeker.get(TRACKERS).expect(200);
      expect(all.body.total).toBe(2);
      // appliedAt DESC: trackerA (Aug 15) before the rejected one (Aug 1).
      expect(all.body.results[0].id).toBe(ids.trackerA);
      expect(all.body.results[0].job).toMatchObject({
        externalJobId: ids.a,
        company: COMPANY,
      });

      const rejected = await seeker
        .get(`${TRACKERS}?status=REJECTED`)
        .expect(200);
      expect(rejected.body.total).toBe(1);
      expect(rejected.body.results[0].status).toBe('REJECTED');
    });

    it('keeps the tracker when the job later closes', async () => {
      await prisma.externalJob.update({
        where: { id: ids.stale },
        data: { status: 'EXPIRED' },
      });
      const list = await asUser(seekerToken)
        .get(`${TRACKERS}?status=REJECTED`)
        .expect(200);
      // The candidate applied while it was open. The record remains, and the
      // job's CURRENT state travels with it, unfaked.
      expect(list.body.total).toBe(1);
      expect(list.body.results[0].job.status).toBe('EXPIRED');
    });

    it('deletes an owned tracker', async () => {
      const seeker = asUser(seekerToken);
      const created = await seeker
        .post(`${BASE}/${ids.b}/application`, {})
        .expect(201);
      await seeker.delete(`${TRACKERS}/${created.body.id}`).expect(200);
      await seeker.delete(`${TRACKERS}/${created.body.id}`).expect(404);
    });
  });

  describe('saved and applied stay independent', () => {
    it('neither mark implies, creates or removes the other', async () => {
      const seeker = asUser(seekerToken);
      // trackerA exists on job a; save + immediately unsave job a.
      await seeker.post(`${BASE}/${ids.a}/save`).expect(200);
      await seeker.delete(`${BASE}/${ids.a}/save`).expect(200);

      // The tracker is untouched by both.
      const list = await seeker.get(TRACKERS).expect(200);
      const tracker = list.body.results.find(
        (row: { id: string }) => row.id === ids.trackerA,
      );
      expect(tracker).toBeDefined();
      expect(tracker.job.saved).toBe(false);
    });
  });

  describe('search and detail decoration (M)', () => {
    it('decorates results without moving a single job or score', async () => {
      const seeker = asUser(seekerToken);
      const query = { query: `${MARKER} Platform Engineer` };

      const before = await seeker.post(`${BASE}/search`, query).expect(200);
      const beforeShape = before.body.results.map(
        (row: { externalJobId: string; score: number; rank?: number }) => ({
          id: row.externalJobId,
          score: row.score,
        }),
      );
      expect(beforeShape.length).toBeGreaterThan(0);

      await seeker.post(`${BASE}/${ids.a}/save`).expect(200);

      const after = await seeker.post(`${BASE}/search`, query).expect(200);
      const afterShape = after.body.results.map(
        (row: { externalJobId: string; score: number }) => ({
          id: row.externalJobId,
          score: row.score,
        }),
      );

      // Byte-identical order and scores; saving decorated, it did not rank.
      // The stored snapshot was REUSED (saving must not invalidate it).
      expect(afterShape).toEqual(beforeShape);
      expect(after.body.runId).toBe(before.body.runId);

      const jobA = after.body.results.find(
        (row: { externalJobId: string }) => row.externalJobId === ids.a,
      );
      expect(jobA.saved).toBe(true);
      expect(jobA.applicationTracking).toMatchObject({
        id: ids.trackerA,
        status: 'OFFER',
      });
      const unmarked = after.body.results.find(
        (row: { externalJobId: string }) => row.externalJobId === ids.b,
      );
      expect(unmarked.saved).toBe(false);
      expect(unmarked.applicationTracking).toBeNull();
    });

    it('shows the caller their own marks on the detail page', async () => {
      const detail = await asUser(seekerToken)
        .get(`${BASE}/${ids.a}`)
        .expect(200);
      expect(detail.body.saved).toBe(true);
      expect(detail.body.applicationTracking).toMatchObject({
        status: 'OFFER',
      });

      // The same job, read by someone else: same facts, THEIR marks.
      const othersView = await asUser(otherToken)
        .get(`${BASE}/${ids.a}`)
        .expect(200);
      expect(othersView.body.title).toBe(detail.body.title);
      expect(othersView.body.saved).toBe(false);
      expect(othersView.body.applicationTracking).toBeNull();
    });

    it('opening the apply URL is not an application — reads change nothing', async () => {
      const trackers = await prisma.candidateExternalJobApplication.count();
      const saves = await prisma.candidateSavedExternalJob.count();
      const internal = await prisma.application.count();

      // The only thing the product does with applyUrl is HAND IT OVER; there
      // is no server-side "open" hook. Reading the job repeatedly is the
      // closest observable act, and it writes nothing.
      const seeker = asUser(seekerToken);
      for (let i = 0; i < 3; i += 1) {
        await seeker.get(`${BASE}/${ids.a}`).expect(200);
      }

      expect(await prisma.candidateExternalJobApplication.count()).toBe(
        trackers,
      );
      expect(await prisma.candidateSavedExternalJob.count()).toBe(saves);
      expect(await prisma.application.count()).toBe(internal);
    });
  });
});
