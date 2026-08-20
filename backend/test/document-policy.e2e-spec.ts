import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { MAX_PERSONAL_DOCUMENTS } from '../src/documents/document-policy';

/**
 * Document ownership & upload policy (e2e, real database + Redis).
 *
 * Proves over real HTTP:
 *  - HR may upload ONLY for a manually added candidate of its own org:
 *    generic (candidate-less) uploads are gone, cross-tenant ids are 404,
 *    application-derived candidates are 403 HR_DOCUMENT_UPLOAD_NOT_ALLOWED.
 *  - A CandidateAccount holds at most 3 personal files — including under
 *    CONCURRENT uploads (real Postgres row lock) — with a stable 409 code on
 *    the 4th, and deletion (bytes + row) frees the slot again.
 *  - Delete is owner-only: foreign ids and org-side copies are 404, and an
 *    ORGANIZATION account cannot reach the candidate endpoints at all.
 *
 * Fixtures are throwaway (unique suffix) and removed afterwards.
 */
describe('Document ownership & upload policy (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const orgSlug = `e2e-docs-${run}`;
  const rivalSlug = `e2e-docs-rival-${run}`;
  const ownerEmail = `docs-owner-${run}@e2e.test`;
  const rivalEmail = `docs-rival-${run}@e2e.test`;
  const seekerEmail = `docs-seeker-${run}@e2e.test`;
  const otherSeekerEmail = `docs-other-${run}@e2e.test`;
  const PASSWORD = 'CorrectHorseBattery1!';

  let ownerToken: string;
  let rivalToken: string;
  let seekerToken: string;
  let otherSeekerToken: string;
  let manualCandidateId: string;
  let rivalCandidateId: string;
  let linkedCandidateId: string;
  let seekerAccountId: string;

  const PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
      'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
  );

  const uploadPersonal = (token: string, filename: string) =>
    request(http)
      .post('/candidate-account/me/documents')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PDF, { filename, contentType: 'application/pdf' });

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
    storage = app.get(StorageService);
    http = app.getHttpServer();

    // Two organizations and two candidate accounts.
    const owner = await request(http).post('/auth/register/organization').send({
      organizationName: 'E2E Docs Org',
      organizationSlug: orgSlug,
      fullName: 'Docs Owner',
      email: ownerEmail,
      password: PASSWORD,
    });
    ownerToken = owner.body.accessToken;

    const rival = await request(http).post('/auth/register/organization').send({
      organizationName: 'E2E Docs Rival',
      organizationSlug: rivalSlug,
      fullName: 'Docs Rival',
      email: rivalEmail,
      password: PASSWORD,
    });
    rivalToken = rival.body.accessToken;

    const seeker = await request(http).post('/auth/register/candidate').send({
      fullName: 'Docs Seeker',
      email: seekerEmail,
      password: PASSWORD,
    });
    seekerToken = seeker.body.accessToken;

    const other = await request(http).post('/auth/register/candidate').send({
      fullName: 'Docs Other',
      email: otherSeekerEmail,
      password: PASSWORD,
    });
    otherSeekerToken = other.body.accessToken;

    const seekerAccount = await prisma.candidateAccount.findFirstOrThrow({
      where: { user: { email: seekerEmail } },
      select: { id: true },
    });
    seekerAccountId = seekerAccount.id;

    // A manual candidate in each organization.
    const manual = await request(http)
      .post('/candidates')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ fullName: 'Manually Added' });
    manualCandidateId = manual.body.id;

    const rivalManual = await request(http)
      .post('/candidates')
      .set('Authorization', `Bearer ${rivalToken}`)
      .send({ fullName: 'Rival Candidate' });
    rivalCandidateId = rivalManual.body.id;

    // An application-derived candidate in the owner org: linked to the
    // seeker's platform account (as the apply flow would create it).
    const ownerOrg = await prisma.organization.findUniqueOrThrow({
      where: { slug: orgSlug },
      select: { id: true },
    });
    const linked = await prisma.candidate.create({
      data: {
        organizationId: ownerOrg.id,
        candidateAccountId: seekerAccountId,
        fullName: 'Docs Seeker',
        email: seekerEmail,
      },
      select: { id: true },
    });
    linkedCandidateId = linked.id;
  });

  afterAll(async () => {
    // Remove any leftover personal storage objects before dropping rows.
    const personalDocs = await prisma.document.findMany({
      where: { candidateAccount: { user: { email: { contains: run } } } },
      select: { storageKey: true },
    });
    await Promise.all(
      personalDocs.map((d) =>
        storage.delete(d.storageKey).catch(() => undefined),
      ),
    );
    await prisma.organization.deleteMany({
      where: { slug: { in: [orgSlug, rivalSlug] } },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: [ownerEmail, rivalEmail, seekerEmail, otherSeekerEmail] },
      },
    });
    await app.close();
  });

  describe('HR upload policy', () => {
    it('uploads to the org’s OWN manual candidate', async () => {
      const res = await request(http)
        .post('/documents')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('candidateId', manualCandidateId)
        .attach('file', PDF, {
          filename: 'manual-resume.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(201);
      const doc = await prisma.document.findUniqueOrThrow({
        where: { id: res.body.id },
        select: {
          organizationId: true,
          candidateId: true,
          candidateAccountId: true,
        },
      });
      expect(doc.candidateId).toBe(manualCandidateId);
      expect(doc.candidateAccountId).toBeNull();
    });

    it('refuses a generic upload with no candidate (the old paths are gone)', async () => {
      const res = await request(http)
        .post('/documents')
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', PDF, {
          filename: 'generic.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(400);
    });

    it('404s another organization’s candidate (no existence leak)', async () => {
      const res = await request(http)
        .post('/documents')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('candidateId', rivalCandidateId)
        .attach('file', PDF, {
          filename: 'cross-tenant.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(404);
    });

    it('403s an application-derived candidate with a stable code', async () => {
      const res = await request(http)
        .post('/documents')
        .set('Authorization', `Bearer ${ownerToken}`)
        .field('candidateId', linkedCandidateId)
        .attach('file', PDF, {
          filename: 'not-yours.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('HR_DOCUMENT_UPLOAD_NOT_ALLOWED');
      // Nothing landed in the seeker's personal collection.
      const personal = await prisma.document.count({
        where: { candidateAccountId: seekerAccountId },
      });
      expect(personal).toBe(0);
    });

    it('a CANDIDATE account cannot use the HR upload endpoint at all', async () => {
      const res = await request(http)
        .post('/documents')
        .set('Authorization', `Bearer ${seekerToken}`)
        .field('candidateId', manualCandidateId)
        .attach('file', PDF, {
          filename: 'wrong-door.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('candidate 3-file limit, delete and slot recycling', () => {
    const uploadedIds: string[] = [];

    it('accepts the first three personal files', async () => {
      for (const name of ['file-a.pdf', 'file-b.pdf', 'file-c.pdf']) {
        const res = await uploadPersonal(seekerToken, name);
        expect(res.status).toBe(201);
        uploadedIds.push(res.body.id as string);
      }

      const list = await request(http)
        .get('/candidate-account/me/documents')
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(MAX_PERSONAL_DOCUMENTS);
      expect(list.body.remaining).toBe(0);
      // The newest upload is the primary resume used at apply time.
      expect(list.body.primaryDocumentId).toBe(uploadedIds[2]);
    });

    it('rejects the fourth with 409 PERSONAL_DOCUMENT_LIMIT_REACHED', async () => {
      const res = await uploadPersonal(seekerToken, 'file-d.pdf');

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PERSONAL_DOCUMENT_LIMIT_REACHED');
      const count = await prisma.document.count({
        where: { candidateAccountId: seekerAccountId },
      });
      expect(count).toBe(MAX_PERSONAL_DOCUMENTS);
    });

    it('another candidate cannot delete my file; an org account cannot even call the endpoint', async () => {
      await request(http)
        .delete(`/candidate-account/me/documents/${uploadedIds[1]}`)
        .set('Authorization', `Bearer ${otherSeekerToken}`)
        .expect(404);
      await request(http)
        .delete(`/candidate-account/me/documents/${uploadedIds[1]}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    });

    it('the candidate delete endpoint cannot touch an org-side copy', async () => {
      const orgDoc = await prisma.document.findFirstOrThrow({
        where: { candidateId: manualCandidateId },
        select: { id: true },
      });
      await request(http)
        .delete(`/candidate-account/me/documents/${orgDoc.id}`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(404);
    });

    it('deleting file B removes its bytes and row; A and C survive', async () => {
      const deleted = await prisma.document.findUniqueOrThrow({
        where: { id: uploadedIds[1] },
        select: { storageKey: true },
      });
      expect(await storage.exists(deleted.storageKey)).toBe(true);

      const res = await request(http)
        .delete(`/candidate-account/me/documents/${uploadedIds[1]}`)
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: uploadedIds[1], deleted: true });

      expect(
        await prisma.document.findUnique({ where: { id: uploadedIds[1] } }),
      ).toBeNull();
      expect(await storage.exists(deleted.storageKey)).toBe(false);

      const survivors = await prisma.document.findMany({
        where: { candidateAccountId: seekerAccountId },
        select: { id: true },
      });
      expect(survivors.map((d) => d.id).sort()).toEqual(
        [uploadedIds[0], uploadedIds[2]].sort(),
      );
    });

    it('the freed slot accepts a new upload', async () => {
      const res = await uploadPersonal(seekerToken, 'file-d.pdf');
      expect(res.status).toBe(201);
    });

    it('concurrent uploads cannot exceed the limit (real row lock)', async () => {
      // Free exactly one slot, then race two uploads for it.
      const current = await prisma.document.findMany({
        where: { candidateAccountId: seekerAccountId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      await request(http)
        .delete(`/candidate-account/me/documents/${current[0].id}`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(200);

      const [first, second] = await Promise.all([
        uploadPersonal(seekerToken, 'race-1.pdf'),
        uploadPersonal(seekerToken, 'race-2.pdf'),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const count = await prisma.document.count({
        where: { candidateAccountId: seekerAccountId },
      });
      expect(count).toBe(MAX_PERSONAL_DOCUMENTS);
    });

    it('deleting the primary repoints it to the newest survivor', async () => {
      const account = await prisma.candidateAccount.findUniqueOrThrow({
        where: { id: seekerAccountId },
        select: { resumeDocumentId: true },
      });
      await request(http)
        .delete(`/candidate-account/me/documents/${account.resumeDocumentId!}`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(200);

      const after = await prisma.candidateAccount.findUniqueOrThrow({
        where: { id: seekerAccountId },
        select: { resumeDocumentId: true },
      });
      const newest = await prisma.document.findFirst({
        where: { candidateAccountId: seekerAccountId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      expect(after.resumeDocumentId).toBe(newest!.id);
    });
  });
});
