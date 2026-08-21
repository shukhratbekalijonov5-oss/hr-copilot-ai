import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAX_CANDIDATE_LINKS } from '../src/candidate-links/link-policy';
import { MAX_PERSONAL_DOCUMENTS } from '../src/documents/document-policy';
import { LinkStatus } from '../src/generated/prisma/enums';

/**
 * Professional links as evidence (e2e, real database).
 *
 * Proves over real HTTP what unit tests can only assert against mocks:
 *
 *  - the 3-link limit is enforced by the SERVER, with a stable error code, and
 *    is INDEPENDENT of the 3-file limit (3 + 3 = 6 sources is the intent);
 *  - the SSRF policy rejects unsafe targets at the API boundary, before any
 *    row is written and long before any socket is opened;
 *  - links are owner-scoped: another candidate's link id is a 404, and HR has
 *    no route to create, edit, delete or refresh one at all;
 *  - deleting a personal link WITHDRAWS it from every application it was sent
 *    to — the copy, its citations and the requirement verdicts built on them —
 *    while the applications themselves survive. The candidate owns their
 *    evidence, and that is the single most important guarantee in the feature.
 *
 * Fixtures are throwaway (unique suffix) and removed afterwards.
 */
describe('Professional link evidence (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const orgSlug = `e2e-links-${run}`;
  const ownerEmail = `links-owner-${run}@e2e.test`;
  const seekerEmail = `links-seeker-${run}@e2e.test`;
  const otherSeekerEmail = `links-other-${run}@e2e.test`;
  const PASSWORD = 'CorrectHorseBattery1!';

  let ownerToken: string;
  let seekerToken: string;
  let otherSeekerToken: string;
  let seekerAccountId: string;
  let orgId: string;
  let candidateId: string;

  const addLink = (token: string, url: string, title?: string) =>
    request(http)
      .post('/candidate-account/me/links')
      .set('Authorization', `Bearer ${token}`)
      .send(title ? { url, title } : { url });

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

    const owner = await request(http).post('/auth/register/organization').send({
      organizationName: 'E2E Links Org',
      organizationSlug: orgSlug,
      fullName: 'Links Owner',
      email: ownerEmail,
      password: PASSWORD,
    });
    ownerToken = owner.body.accessToken;

    const seeker = await request(http).post('/auth/register/candidate').send({
      fullName: 'Links Seeker',
      email: seekerEmail,
      password: PASSWORD,
    });
    seekerToken = seeker.body.accessToken;

    const other = await request(http).post('/auth/register/candidate').send({
      fullName: 'Links Other',
      email: otherSeekerEmail,
      password: PASSWORD,
    });
    otherSeekerToken = other.body.accessToken;

    seekerAccountId = (
      await prisma.candidateAccount.findFirstOrThrow({
        where: { user: { email: seekerEmail } },
        select: { id: true },
      })
    ).id;

    orgId = (
      await prisma.organization.findUniqueOrThrow({
        where: { slug: orgSlug },
        select: { id: true },
      })
    ).id;

    candidateId = (
      await prisma.candidate.create({
        data: {
          organizationId: orgId,
          candidateAccountId: seekerAccountId,
          fullName: 'Links Seeker',
          email: seekerEmail,
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: orgSlug } });
    await prisma.user.deleteMany({
      where: { email: { in: [ownerEmail, seekerEmail, otherSeekerEmail] } },
    });
    await app.close();
  });

  afterEach(async () => {
    await prisma.candidateLink.deleteMany({
      where: { candidateAccountId: seekerAccountId },
    });
  });

  describe('the three-link limit, enforced by the server', () => {
    it('accepts three and rejects the fourth with a stable code', async () => {
      for (let index = 1; index <= MAX_CANDIDATE_LINKS; index += 1) {
        const response = await addLink(
          seekerToken,
          `https://portfolio-${index}.example.com`,
        );
        expect(response.status).toBe(201);
      }

      const fourth = await addLink(
        seekerToken,
        'https://one-too-many.example.com',
      );
      expect(fourth.status).toBe(409);
      expect(fourth.body.code).toBe('LINK_LIMIT_REACHED');

      expect(
        await prisma.candidateLink.count({
          where: { candidateAccountId: seekerAccountId },
        }),
      ).toBe(MAX_CANDIDATE_LINKS);
    });

    it('reports the remaining slots so the UI never has to count', async () => {
      await addLink(seekerToken, 'https://portfolio.example.com');

      const list = await request(http)
        .get('/candidate-account/me/links')
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({
        limit: MAX_CANDIDATE_LINKS,
        remaining: MAX_CANDIDATE_LINKS - 1,
      });
    });

    it('holds concurrent adds to three (real Postgres row lock)', async () => {
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          addLink(seekerToken, `https://race-${index}.example.com`),
        ),
      );

      const created = responses.filter((r) => r.status === 201).length;
      expect(created).toBeLessThanOrEqual(MAX_CANDIDATE_LINKS);
      expect(
        await prisma.candidateLink.count({
          where: { candidateAccountId: seekerAccountId },
        }),
      ).toBeLessThanOrEqual(MAX_CANDIDATE_LINKS);
    });

    it('counts a FAILED link against the limit until it is removed', async () => {
      // Same rule as files: a slot is a slot whatever state it is in, so
      // "why can I not add another?" has exactly one answer.
      await prisma.candidateLink.createMany({
        data: Array.from({ length: MAX_CANDIDATE_LINKS }, (_, index) => ({
          candidateAccountId: seekerAccountId,
          url: `https://failed-${index}.example.com/`,
          normalizedUrl: `failed-${index}.example.com`,
          status: LinkStatus.FAILED,
          failureCode: 'FETCH_TIMEOUT' as const,
        })),
      });

      const blocked = await addLink(seekerToken, 'https://fresh.example.com');
      expect(blocked.status).toBe(409);

      const doomed = await prisma.candidateLink.findFirstOrThrow({
        where: { candidateAccountId: seekerAccountId },
        select: { id: true },
      });
      const removed = await request(http)
        .delete(`/candidate-account/me/links/${doomed.id}`)
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(removed.status).toBe(200);

      const afterDelete = await addLink(
        seekerToken,
        'https://fresh.example.com',
      );
      expect(afterDelete.status).toBe(201);
    });
  });

  describe('file and link budgets are independent', () => {
    it('allows 3 links alongside a full set of 3 files', async () => {
      // The product's stated maximum is 3 + 3 = 6 evidence sources. A shared
      // budget would mean somebody with no portfolio gets fewer file slots.
      await prisma.document.createMany({
        data: Array.from({ length: MAX_PERSONAL_DOCUMENTS }, (_, index) => ({
          candidateAccountId: seekerAccountId,
          originalFileName: `file-${index}.pdf`,
          storageKey: `candidate/${seekerAccountId}/e2e-${run}-${index}.pdf`,
          mimeType: 'application/pdf',
          fileSize: 1024,
        })),
      });

      for (let index = 0; index < MAX_CANDIDATE_LINKS; index += 1) {
        const response = await addLink(
          seekerToken,
          `https://both-${index}.example.com`,
        );
        expect(response.status).toBe(201);
      }

      const documents = await request(http)
        .get('/candidate-account/me/documents')
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(documents.body.remaining).toBe(0);

      const links = await request(http)
        .get('/candidate-account/me/links')
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(links.body.data).toHaveLength(MAX_CANDIDATE_LINKS);

      await prisma.document.deleteMany({
        where: { candidateAccountId: seekerAccountId },
      });
    });
  });

  describe('duplicate detection', () => {
    it('treats spellings of the same page as one source', async () => {
      expect((await addLink(seekerToken, 'https://portfolio.dev')).status).toBe(
        201,
      );

      for (const variant of [
        'https://portfolio.dev/',
        'http://portfolio.dev',
        'https://www.portfolio.dev',
        'https://portfolio.dev/?utm_source=twitter',
        'https://portfolio.dev/#projects',
      ]) {
        const duplicate = await addLink(seekerToken, variant);
        expect({ variant, status: duplicate.status }).toEqual({
          variant,
          status: 409,
        });
        expect(duplicate.body.code).toBe('LINK_DUPLICATE');
      }

      expect(
        await prisma.candidateLink.count({
          where: { candidateAccountId: seekerAccountId },
        }),
      ).toBe(1);
    });

    it('keeps genuinely different pages of one site apart', async () => {
      expect(
        (await addLink(seekerToken, 'https://portfolio.dev/projects')).status,
      ).toBe(201);
      expect(
        (await addLink(seekerToken, 'https://portfolio.dev/about')).status,
      ).toBe(201);
    });
  });

  describe('SSRF policy at the API boundary', () => {
    it.each([
      ['http://localhost/admin', 'PRIVATE_NETWORK_URL'],
      ['http://127.0.0.1/', 'PRIVATE_NETWORK_URL'],
      ['http://[::1]/', 'PRIVATE_NETWORK_URL'],
      ['http://10.0.0.1/', 'PRIVATE_NETWORK_URL'],
      ['http://172.16.4.5/', 'PRIVATE_NETWORK_URL'],
      ['http://192.168.1.1/', 'PRIVATE_NETWORK_URL'],
      ['http://169.254.169.254/latest/meta-data/', 'PRIVATE_NETWORK_URL'],
      ['https://api.internal/v1', 'PRIVATE_NETWORK_URL'],
      ['https://printer.local/', 'PRIVATE_NETWORK_URL'],
      ['file:///etc/passwd', 'UNSUPPORTED_PROTOCOL'],
      ['ftp://files.example.com/x', 'UNSUPPORTED_PROTOCOL'],
      ['gopher://example.com/', 'UNSUPPORTED_PROTOCOL'],
      ['http://example.com:6379/', 'UNSUPPORTED_PROTOCOL'],
      ['https://user:pass@example.com/', 'INVALID_URL'],
    ])('rejects %s before writing anything', async (url, failureCode) => {
      const response = await addLink(seekerToken, url);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('LINK_INVALID_URL');
      // The specific reason travels too, so the UI can say WHY.
      expect(response.body.failureCode).toBe(failureCode);
      expect(
        await prisma.candidateLink.count({
          where: { candidateAccountId: seekerAccountId },
        }),
      ).toBe(0);
    });

    it('never echoes the rejected URL back in the message', async () => {
      const response = await addLink(
        seekerToken,
        'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      );
      expect(JSON.stringify(response.body)).not.toContain('169.254.169.254');
    });
  });

  describe('ownership', () => {
    it('another candidate cannot read, edit, delete or refresh a link', async () => {
      const created = await addLink(seekerToken, 'https://mine.example.com');
      const linkId = created.body.id;

      const asOther = (method: 'patch' | 'delete' | 'post', path: string) =>
        request(http)
          [method](path)
          .set('Authorization', `Bearer ${otherSeekerToken}`)
          .send({ url: 'https://hijacked.example.com' });

      expect(
        (await asOther('patch', `/candidate-account/me/links/${linkId}`))
          .status,
      ).toBe(404);
      expect(
        (await asOther('delete', `/candidate-account/me/links/${linkId}`))
          .status,
      ).toBe(404);
      expect(
        (
          await asOther(
            'post',
            `/candidate-account/me/links/${linkId}/reprocess`,
          )
        ).status,
      ).toBe(404);

      // And the other candidate's own list never mentions it.
      const theirList = await request(http)
        .get('/candidate-account/me/links')
        .set('Authorization', `Bearer ${otherSeekerToken}`);
      expect(theirList.body.data).toEqual([]);

      // Untouched.
      const stillMine = await prisma.candidateLink.findUniqueOrThrow({
        where: { id: linkId },
      });
      expect(stillMine.url).toBe('https://mine.example.com/');
    });
  });

  describe('HR has no write access to candidate links, anywhere', () => {
    it('cannot reach the candidate link routes at all', async () => {
      // @CandidateScoped: an ORGANIZATION account is refused whatever its
      // role, exactly as for personal documents.
      for (const [method, path] of [
        ['get', '/candidate-account/me/links'],
        ['post', '/candidate-account/me/links'],
      ] as const) {
        const response = await request(http)
          [method](path)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ url: 'https://hr-should-not.example.com' });
        expect([401, 403, 404]).toContain(response.status);
      }
    });

    it('has no recruiter-side link endpoint to call', async () => {
      // Not "refused by a policy branch" — the route does not exist.
      for (const path of [
        `/candidates/${candidateId}/links`,
        `/candidates/${candidateId}/link-sources`,
      ]) {
        const response = await request(http)
          .post(path)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ url: 'https://hr-should-not.example.com' });
        expect(response.status).toBe(404);
      }
    });

    it('reads submitted link snapshots, and only those', async () => {
      // The candidate's LIVE personal link…
      await addLink(seekerToken, 'https://current-private.example.com');
      // …and a separate frozen copy submitted with an application.
      const vacancy = await prisma.vacancy.create({
        data: {
          organizationId: orgId,
          title: 'Backend Engineer',
          publicSlug: `e2e-links-vac-${run}`,
          status: 'OPEN',
          createdById: (
            await prisma.user.findUniqueOrThrow({
              where: { email: ownerEmail },
              select: { id: true },
            })
          ).id,
        },
        select: { id: true },
      });
      const application = await prisma.application.create({
        data: { vacancyId: vacancy.id, candidateId, source: 'DIRECT' },
        select: { id: true },
      });
      await prisma.applicationLinkSource.create({
        data: {
          organizationId: orgId,
          candidateId,
          applicationId: application.id,
          url: 'https://submitted.example.com/',
          normalizedUrl: 'submitted.example.com',
          title: 'Portfolio Website',
          sections: [
            { name: 'projects', heading: null, text: 'K8s work', url: null },
          ],
          charCount: 8,
          fetchedAt: new Date(),
          status: 'COMPLETED',
        },
      });

      const detail = await request(http)
        .get(`/candidates/${candidateId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(detail.status).toBe(200);
      expect(detail.body.linkSources).toHaveLength(1);
      expect(detail.body.linkSources[0]).toMatchObject({
        url: 'https://submitted.example.com/',
        title: 'Portfolio Website',
      });
      // The candidate's CURRENT personal link is not reachable from here.
      expect(JSON.stringify(detail.body)).not.toContain('current-private');
      // Nor is the extracted text dumped into the recruiter payload.
      expect(detail.body.linkSources[0].sections).toBeUndefined();

      await prisma.vacancy.delete({ where: { id: vacancy.id } });
    });
  });

  describe('deleting a personal link withdraws it from every application', () => {
    it('removes the submitted snapshot but KEEPS the application', async () => {
      const created = await addLink(
        seekerToken,
        'https://portfolio.example.com',
        'My portfolio',
      );
      const linkId = created.body.id;

      const vacancy = await prisma.vacancy.create({
        data: {
          organizationId: orgId,
          title: 'Platform Engineer',
          publicSlug: `e2e-links-snap-${run}`,
          status: 'OPEN',
          createdById: (
            await prisma.user.findUniqueOrThrow({
              where: { email: ownerEmail },
              select: { id: true },
            })
          ).id,
        },
        select: { id: true },
      });
      const application = await prisma.application.create({
        data: { vacancyId: vacancy.id, candidateId, source: 'DIRECT' },
        select: { id: true },
      });
      const snapshot = await prisma.applicationLinkSource.create({
        data: {
          organizationId: orgId,
          candidateId,
          applicationId: application.id,
          // A plain column, NOT a foreign key — this is what lets the personal
          // link disappear without cascading into the organization's record.
          sourceLinkId: linkId,
          url: 'https://portfolio.example.com/',
          normalizedUrl: 'portfolio.example.com',
          title: 'My portfolio',
          sections: [
            {
              name: 'projects',
              heading: 'Projects',
              text: 'Kubernetes deployment, forty nodes.',
              url: 'https://portfolio.example.com/projects',
            },
          ],
          contentHash: 'v1-hash',
          charCount: 35,
          fetchedAt: new Date(),
          status: 'COMPLETED',
        },
        select: { id: true },
      });

      const deleted = await request(http)
        .delete(`/candidate-account/me/links/${linkId}`)
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(deleted.status).toBe(200);

      // The personal source is gone…
      expect(
        await prisma.candidateLink.findUnique({ where: { id: linkId } }),
      ).toBeNull();

      // …and so is the copy the organization was given. The candidate owns
      // this evidence: withdrawing it withdraws it from the recruiters they
      // sent it to, not just from their own profile page.
      expect(
        await prisma.applicationLinkSource.findUnique({
          where: { id: snapshot.id },
        }),
      ).toBeNull();

      // The APPLICATION itself survives — status, vacancy association and all.
      // An application whose evidence was withdrawn is an application with no
      // current evidence, never a deleted application.
      const survivingApplication = await prisma.application.findUnique({
        where: { id: application.id },
        select: { id: true, status: true, vacancyId: true },
      });
      expect(survivingApplication).toMatchObject({
        id: application.id,
        status: 'NEW',
        vacancyId: vacancy.id,
      });

      // And the recruiter no longer sees the withdrawn source.
      const detail = await request(http)
        .get(`/candidates/${candidateId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(
        detail.body.linkSources.some(
          (source: { id: string }) => source.id === snapshot.id,
        ),
      ).toBe(false);

      await prisma.vacancy.delete({ where: { id: vacancy.id } });
    });

    it('withdraws it from EVERY application, and touches no other source', async () => {
      // Lineage has to be exact: the same link submitted to two vacancies is
      // withdrawn from both, while an unrelated link submitted alongside it
      // stays exactly where it is.
      const target = await addLink(
        seekerToken,
        'https://target.example.com',
        'Target link',
      );
      const bystander = await addLink(
        seekerToken,
        'https://bystander.example.com',
        'Bystander link',
      );
      const ownerId = (
        await prisma.user.findUniqueOrThrow({
          where: { email: ownerEmail },
          select: { id: true },
        })
      ).id;

      const snapshotIds: string[] = [];
      const applicationIds: string[] = [];
      const vacancyIds: string[] = [];

      for (const index of [1, 2]) {
        const vacancy = await prisma.vacancy.create({
          data: {
            organizationId: orgId,
            title: `Multi Application ${index}`,
            publicSlug: `e2e-links-multi-${run}-${index}`,
            status: 'OPEN',
            createdById: ownerId,
          },
          select: { id: true },
        });
        vacancyIds.push(vacancy.id);

        const application = await prisma.application.create({
          data: { vacancyId: vacancy.id, candidateId, source: 'DIRECT' },
          select: { id: true },
        });
        applicationIds.push(application.id);

        const snapshot = await prisma.applicationLinkSource.create({
          data: {
            organizationId: orgId,
            candidateId,
            applicationId: application.id,
            sourceLinkId: target.body.id,
            url: 'https://target.example.com/',
            normalizedUrl: 'target.example.com',
            title: 'Target link',
            sections: [
              { name: 'projects', heading: 'Projects', text: 'Work.' },
            ],
            charCount: 5,
            fetchedAt: new Date(),
            status: 'COMPLETED',
          },
          select: { id: true },
        });
        snapshotIds.push(snapshot.id);
      }

      // The bystander's snapshot sits in the SAME application as one of them.
      const bystanderSnapshot = await prisma.applicationLinkSource.create({
        data: {
          organizationId: orgId,
          candidateId,
          applicationId: applicationIds[0],
          sourceLinkId: bystander.body.id,
          url: 'https://bystander.example.com/',
          normalizedUrl: 'bystander.example.com',
          title: 'Bystander link',
          sections: [{ name: 'about', heading: 'About', text: 'Unrelated.' }],
          charCount: 9,
          fetchedAt: new Date(),
          status: 'COMPLETED',
        },
        select: { id: true },
      });

      const deleted = await request(http)
        .delete(`/candidate-account/me/links/${target.body.id}`)
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(deleted.status).toBe(200);

      // Gone from BOTH applications.
      expect(
        await prisma.applicationLinkSource.count({
          where: { id: { in: snapshotIds } },
        }),
      ).toBe(0);

      // The unrelated source is untouched — deletion is by lineage, not by
      // candidate, so it can never become a blanket wipe.
      expect(
        await prisma.applicationLinkSource.findUnique({
          where: { id: bystanderSnapshot.id },
        }),
      ).not.toBeNull();
      expect(
        await prisma.candidateLink.findUnique({
          where: { id: bystander.body.id },
        }),
      ).not.toBeNull();

      // Both applications survive.
      expect(
        await prisma.application.count({
          where: { id: { in: applicationIds } },
        }),
      ).toBe(2);

      await prisma.vacancy.deleteMany({ where: { id: { in: vacancyIds } } });
    });

    it('invalidates the requirement mappings that cited the withdrawn source', async () => {
      // A stored "EVIDENCE_FOUND" whose proof has been deleted is worse than
      // no verdict: a recruiter would read a conclusion with nothing behind it.
      const link = await addLink(
        seekerToken,
        'https://mapped.example.com',
        'Mapped link',
      );
      const ownerId = (
        await prisma.user.findUniqueOrThrow({
          where: { email: ownerEmail },
          select: { id: true },
        })
      ).id;
      const vacancy = await prisma.vacancy.create({
        data: {
          organizationId: orgId,
          title: 'Mapped Vacancy',
          publicSlug: `e2e-links-mapped-${run}`,
          status: 'OPEN',
          createdById: ownerId,
          requirements: {
            create: [{ text: 'Kubernetes', type: 'SKILL', required: true }],
          },
        },
        select: { id: true, requirements: { select: { id: true } } },
      });
      const application = await prisma.application.create({
        data: { vacancyId: vacancy.id, candidateId, source: 'DIRECT' },
        select: { id: true },
      });
      const snapshot = await prisma.applicationLinkSource.create({
        data: {
          organizationId: orgId,
          candidateId,
          applicationId: application.id,
          sourceLinkId: link.body.id,
          url: 'https://mapped.example.com/',
          normalizedUrl: 'mapped.example.com',
          title: 'Mapped link',
          sections: [{ name: 'projects', heading: 'Projects', text: 'K8s.' }],
          charCount: 4,
          fetchedAt: new Date(),
          status: 'COMPLETED',
        },
        select: { id: true },
      });
      const map = await prisma.requirementEvidenceMap.create({
        data: {
          organizationId: orgId,
          candidateId,
          vacancyId: vacancy.id,
          requirementId: vacancy.requirements[0].id,
          status: 'EVIDENCE_FOUND',
          reason: 'Kubernetes appears in the submitted link.',
          matchedTerms: ['Kubernetes'],
          missingTerms: [],
          evidence: {
            create: [
              {
                organizationId: orgId,
                candidateId,
                vacancyId: vacancy.id,
                requirementId: vacancy.requirements[0].id,
                linkSourceId: snapshot.id,
                text: 'K8s.',
              },
            ],
          },
        },
        select: { id: true },
      });

      await request(http)
        .delete(`/candidate-account/me/links/${link.body.id}`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(200);

      // The verdict is gone, not left standing with an empty citation list.
      expect(
        await prisma.requirementEvidenceMap.findUnique({
          where: { id: map.id },
        }),
      ).toBeNull();
      expect(
        await prisma.candidateEvidence.count({
          where: { linkSourceId: snapshot.id },
        }),
      ).toBe(0);

      await prisma.vacancy.delete({ where: { id: vacancy.id } });
    });
  });

  /**
   * These blocks create their link rows DIRECTLY rather than through the API.
   *
   * A row created through POST is immediately enqueued, and the live worker
   * then genuinely moves its status (FETCHING → FAILED for a host that does
   * not resolve). Asserting on a status the worker owns would be testing a
   * race, so the fixtures here are never enqueued and the assertions are on
   * what the REQUEST does — the response it returns, and the fields only a
   * successful fetch would ever rewrite.
   */
  const seedLink = (
    overrides: Partial<{
      url: string;
      normalizedUrl: string;
      status: LinkStatus;
      failureCode: 'ACCESS_DENIED' | 'FETCH_TIMEOUT';
      contentHash: string;
      title: string;
    }> = {},
  ) =>
    prisma.candidateLink.create({
      data: {
        candidateAccountId: seekerAccountId,
        url: overrides.url ?? 'https://seeded.example.com/',
        normalizedUrl: overrides.normalizedUrl ?? 'seeded.example.com',
        status: overrides.status ?? LinkStatus.COMPLETED,
        failureCode: overrides.failureCode ?? null,
        contentHash: overrides.contentHash ?? null,
        title: overrides.title ?? null,
      },
      select: { id: true },
    });

  describe('editing a link', () => {
    it('re-fetches from scratch when the URL changes', async () => {
      const link = await seedLink({
        contentHash: 'old-hash',
      });
      await prisma.candidateLink.update({
        where: { id: link.id },
        data: {
          sections: [{ name: null, heading: null, text: 'old', url: null }],
        },
      });

      const updated = await request(http)
        .patch(`/candidate-account/me/links/${link.id}`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ url: 'https://replacement.example.com' });

      expect(updated.status).toBe(200);
      // Keeping the old text under a new URL would make every citation from
      // it a lie, so the content is cleared and the fetch starts over.
      expect(updated.body.status).toBe(LinkStatus.PENDING);
      const row = await prisma.candidateLink.findUniqueOrThrow({
        where: { id: link.id },
      });
      expect(row.url).toBe('https://replacement.example.com/');
      // Only a SUCCESSFUL fetch ever writes these back, so they are stable
      // regardless of what the worker does with this row afterwards.
      expect(row.contentHash).toBeNull();
      expect(row.sections).toBeNull();
    });

    it('renames without discarding the analysed content', async () => {
      const link = await seedLink({ contentHash: 'keep-me' });

      const renamed = await request(http)
        .patch(`/candidate-account/me/links/${link.id}`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ url: 'https://seeded.example.com', title: 'Renamed' });

      expect(renamed.status).toBe(200);
      expect(renamed.body.title).toBe('Renamed');
      const row = await prisma.candidateLink.findUniqueOrThrow({
        where: { id: link.id },
      });
      expect(row.title).toBe('Renamed');
      // Unchanged URL means no re-fetch: the analysed content survives.
      expect(row.contentHash).toBe('keep-me');
    });

    it('rejects an unsafe replacement URL as firmly as a new one', async () => {
      const link = await seedLink({ url: 'https://safe.example.com/' });

      const response = await request(http)
        .patch(`/candidate-account/me/links/${link.id}`)
        .set('Authorization', `Bearer ${seekerToken}`)
        .send({ url: 'http://169.254.169.254/' });

      expect(response.status).toBe(400);
      expect(response.body.failureCode).toBe('PRIVATE_NETWORK_URL');
      expect(
        (
          await prisma.candidateLink.findUniqueOrThrow({
            where: { id: link.id },
          })
        ).url,
      ).toBe('https://safe.example.com/');
    });
  });

  describe('retry policy', () => {
    it('refuses to retry a permanently failed link', async () => {
      const link = await seedLink({
        status: LinkStatus.FAILED,
        failureCode: 'ACCESS_DENIED',
      });

      const retry = await request(http)
        .post(`/candidate-account/me/links/${link.id}/reprocess`)
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(retry.status).toBe(409);
      expect(retry.body.code).toBe('LINK_NOT_RETRYABLE');
    });

    it('re-queues a transiently failed link', async () => {
      const link = await seedLink({
        status: LinkStatus.FAILED,
        failureCode: 'FETCH_TIMEOUT',
      });

      const retry = await request(http)
        .post(`/candidate-account/me/links/${link.id}/reprocess`)
        .set('Authorization', `Bearer ${seekerToken}`);

      expect(retry.status).toBe(201);
      expect(retry.body.status).toBe(LinkStatus.PENDING);
      expect(retry.body.failureCode).toBeNull();
    });
  });

  describe('response shape', () => {
    it('never exposes the extracted text or the storage identity', async () => {
      const created = await addLink(seekerToken, 'https://shape.example.com');
      await prisma.candidateLink.update({
        where: { id: created.body.id },
        data: {
          status: LinkStatus.COMPLETED,
          sections: [
            { name: null, heading: null, text: 'private evidence', url: null },
          ],
        },
      });

      const list = await request(http)
        .get('/candidate-account/me/links')
        .set('Authorization', `Bearer ${seekerToken}`);

      const body = JSON.stringify(list.body);
      expect(body).not.toContain('private evidence');
      expect(body).not.toContain('normalizedUrl');
    });
  });
});
