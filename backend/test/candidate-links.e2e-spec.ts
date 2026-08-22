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

    it('reads the CURRENT links, only under a vacancy context', async () => {
      const link = await addLink(
        seekerToken,
        'https://current-portfolio.example.com',
        'Portfolio Website',
      );
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
      await prisma.application.create({
        data: { vacancyId: vacancy.id, candidateId, source: 'DIRECT' },
        select: { id: true },
      });

      // Candidate Detail itself carries NO evidence: there is no frozen copy
      // to serve, and a plain candidate id must never become a general-purpose
      // way to read someone's links.
      const detail = await request(http)
        .get(`/candidates/${candidateId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.linkSources).toBeUndefined();
      expect(JSON.stringify(detail.body)).not.toContain('current-portfolio');

      // The evidence is reached only through the vacancy-contextual chain,
      // and what it returns is the LIVE link.
      const evidence = await request(http)
        .get(`/candidates/${candidateId}/current-evidence`)
        .query({ vacancyId: vacancy.id })
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(evidence.status).toBe(200);
      expect(evidence.body.professionalLinks).toHaveLength(1);
      expect(evidence.body.professionalLinks[0]).toMatchObject({
        id: link.body.id,
        title: 'Portfolio Website',
      });
      expect(evidence.body.professionalLinks[0].url).toContain(
        'current-portfolio.example.com',
      );
      // Still no raw extracted text, and no storage identity.
      expect(evidence.body.professionalLinks[0].sections).toBeUndefined();
      expect(JSON.stringify(evidence.body)).not.toContain('normalizedUrl');

      // Without the vacancy the request is not even well-formed.
      await request(http)
        .get(`/candidates/${candidateId}/current-evidence`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);

      await prisma.vacancy.delete({ where: { id: vacancy.id } });
    });
  });

  describe('deleting a personal link withdraws it from every recruiter', () => {
    /** A vacancy owned by the fixture recruiter, with this candidate applied. */
    async function vacancyWithApplication(slug: string, title: string) {
      const ownerId = (
        await prisma.user.findUniqueOrThrow({
          where: { email: ownerEmail },
          select: { id: true },
        })
      ).id;
      const vacancy = await prisma.vacancy.create({
        data: {
          organizationId: orgId,
          title,
          publicSlug: slug,
          status: 'OPEN',
          createdById: ownerId,
        },
        select: { id: true },
      });
      const application = await prisma.application.create({
        data: { vacancyId: vacancy.id, candidateId, source: 'DIRECT' },
        select: { id: true },
      });
      return { vacancyId: vacancy.id, applicationId: application.id };
    }

    /** What the recruiter can see of this candidate in one vacancy, now. */
    async function recruiterSeesLinks(vacancyId: string): Promise<string[]> {
      const response = await request(http)
        .get(`/candidates/${candidateId}/current-evidence`)
        .query({ vacancyId })
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(response.status).toBe(200);
      return response.body.professionalLinks.map(
        (link: { id: string }) => link.id,
      );
    }

    it('takes it away from the recruiter but KEEPS the application', async () => {
      const created = await addLink(
        seekerToken,
        'https://portfolio.example.com',
        'My portfolio',
      );
      const linkId = created.body.id;
      const { vacancyId, applicationId } = await vacancyWithApplication(
        `e2e-links-snap-${run}`,
        'Platform Engineer',
      );

      expect(await recruiterSeesLinks(vacancyId)).toContain(linkId);

      const deleted = await request(http)
        .delete(`/candidate-account/me/links/${linkId}`)
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(deleted.status).toBe(200);

      // The one and only copy is gone…
      expect(
        await prisma.candidateLink.findUnique({ where: { id: linkId } }),
      ).toBeNull();

      // …so the recruiter it was offered to loses it in the same instant.
      // The candidate owns this evidence: withdrawing it withdraws it from
      // the recruiters they sent it to, not just from their own profile page.
      expect(await recruiterSeesLinks(vacancyId)).not.toContain(linkId);

      // The APPLICATION itself survives — status, vacancy association and all.
      // An application whose evidence was withdrawn is an application with no
      // current evidence, never a deleted application.
      expect(
        await prisma.application.findUnique({
          where: { id: applicationId },
          select: { id: true, status: true, vacancyId: true },
        }),
      ).toMatchObject({ id: applicationId, status: 'NEW', vacancyId });

      await prisma.vacancy.delete({ where: { id: vacancyId } });
    });

    it('withdraws it from EVERY vacancy, and touches no other source', async () => {
      // The same person applied to two of the recruiter's vacancies. Deleting
      // one link must clear it from both views, while an unrelated link they
      // also hold stays exactly where it is.
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

      const contexts = [
        await vacancyWithApplication(`e2e-links-multi-${run}-1`, 'Multi 1'),
        await vacancyWithApplication(`e2e-links-multi-${run}-2`, 'Multi 2'),
      ];
      for (const context of contexts) {
        const visible = await recruiterSeesLinks(context.vacancyId);
        expect(visible).toEqual(
          expect.arrayContaining([target.body.id, bystander.body.id]),
        );
      }

      const deleted = await request(http)
        .delete(`/candidate-account/me/links/${target.body.id}`)
        .set('Authorization', `Bearer ${seekerToken}`);
      expect(deleted.status).toBe(200);

      for (const context of contexts) {
        const visible = await recruiterSeesLinks(context.vacancyId);
        // Gone from BOTH vacancies…
        expect(visible).not.toContain(target.body.id);
        // …and the unrelated source is untouched: a delete names ONE row, so
        // it can never become a blanket wipe of the person's evidence.
        expect(visible).toContain(bystander.body.id);
      }
      expect(
        await prisma.candidateLink.findUnique({
          where: { id: bystander.body.id },
        }),
      ).not.toBeNull();

      // Both applications survive.
      expect(
        await prisma.application.count({
          where: { id: { in: contexts.map((c) => c.applicationId) } },
        }),
      ).toBe(2);

      await prisma.vacancy.deleteMany({
        where: { id: { in: contexts.map((c) => c.vacancyId) } },
      });
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
      await prisma.application.create({
        data: { vacancyId: vacancy.id, candidateId, source: 'DIRECT' },
        select: { id: true },
      });
      const map = await prisma.requirementEvidenceMap.create({
        data: {
          organizationId: orgId,
          candidateId,
          vacancyId: vacancy.id,
          requirementId: vacancy.requirements[0].id,
          status: 'EVIDENCE_FOUND',
          reason: 'Kubernetes appears in the candidate’s link.',
          matchedTerms: ['Kubernetes'],
          missingTerms: [],
          evidence: {
            create: [
              {
                organizationId: orgId,
                candidateId,
                vacancyId: vacancy.id,
                requirementId: vacancy.requirements[0].id,
                // The citation names the CURRENT link, with a real foreign
                // key behind it — which is what makes the withdrawal
                // automatic rather than something a cleanup has to remember.
                candidateLinkId: link.body.id,
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
      // And the citation went with the row it pointed at.
      expect(
        await prisma.candidateEvidence.count({
          where: { candidateLinkId: link.body.id },
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
