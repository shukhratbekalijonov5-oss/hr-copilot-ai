import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CandidateLinksService } from './candidate-links.service';
import { LINK_ERROR_CODES, MAX_CANDIDATE_LINKS } from './link-policy';
import { LinkFailureCode, LinkStatus } from '../generated/prisma/enums';

const ME = 'user-me';
const MY_ACCOUNT = 'acct-me';

function createPrismaMock() {
  const prisma: any = {
    candidateAccount: {
      findUnique: jest.fn().mockResolvedValue({ id: MY_ACCOUNT }),
    },
    candidateLink: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    // The row lock the create path takes before counting.
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  prisma.$transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg)
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

function createProducerMock() {
  return {
    enqueueCandidateLink: jest.fn().mockResolvedValue('job-1'),
    enqueueCandidateLinkIndexDeletion: jest.fn().mockResolvedValue('job-2'),
    hasLiveLinkJob: jest.fn().mockResolvedValue(false),
  };
}

function createAiMock() {
  return { deletePersonalWebSource: jest.fn().mockResolvedValue(undefined) };
}

/**
 * The lifecycle service owns the cascade itself; here it is a collaborator, so
 * these tests assert that the links service DELEGATES to it rather than
 * re-testing the cascade. The cascade's own behaviour is covered in
 * candidate-evidence.service.spec.ts.
 */
function createEvidenceMock() {
  return {
    cascadePersonalLinkDeletion: jest.fn().mockResolvedValue(undefined),
    cascadeDerivedCopyRemoval: jest.fn().mockResolvedValue(undefined),
    bumpRevision: jest.fn().mockResolvedValue(undefined),
  };
}

function build(
  overrides: { prisma?: any; producer?: any; ai?: any; evidence?: any } = {},
) {
  const prisma = overrides.prisma ?? createPrismaMock();
  const producer = overrides.producer ?? createProducerMock();
  const ai = overrides.ai ?? createAiMock();
  const evidence = overrides.evidence ?? createEvidenceMock();
  const service = new CandidateLinksService(
    prisma as never,
    producer as never,
    ai as never,
    evidence as never,
  );
  return { service, prisma, producer, ai, evidence };
}

const linkRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'link-1',
  candidateAccountId: MY_ACCOUNT,
  url: 'https://portfolio.example.com/',
  normalizedUrl: 'portfolio.example.com',
  title: 'Portfolio',
  detectedType: 'WEBSITE',
  status: LinkStatus.COMPLETED,
  failureCode: null,
  charCount: 900,
  pagesFetched: 2,
  lastFetchedAt: new Date('2026-08-21T00:00:00Z'),
  createdAt: new Date('2026-08-20T00:00:00Z'),
  updatedAt: new Date('2026-08-21T00:00:00Z'),
  ...overrides,
});

describe('CandidateLinksService', () => {
  describe('the three-link limit', () => {
    it.each([0, 1, 2])('accepts a new link when %i exist', async (existing) => {
      const { service, prisma } = build();
      prisma.candidateLink.count.mockResolvedValue(existing);
      prisma.candidateLink.create.mockResolvedValue(linkRow());

      await expect(
        service.create(ME, { url: 'https://portfolio.example.com' }),
      ).resolves.toMatchObject({ id: 'link-1' });
    });

    it('rejects the fourth with a typed 409', async () => {
      const { service, prisma } = build();
      prisma.candidateLink.count.mockResolvedValue(MAX_CANDIDATE_LINKS);

      await expect(
        service.create(ME, { url: 'https://another.example.com' }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create(ME, { url: 'https://another.example.com' }),
      ).rejects.toMatchObject({
        response: { code: LINK_ERROR_CODES.LINK_LIMIT_REACHED },
      });
      expect(prisma.candidateLink.create).not.toHaveBeenCalled();
    });

    it('counts links of EVERY status, including failed ones', async () => {
      // A failed link holds its slot until the candidate removes it — the
      // same rule files follow, so "why can I not add another?" has one answer.
      const { service, prisma } = build();
      prisma.candidateLink.count.mockResolvedValue(3);

      await expect(
        service.create(ME, { url: 'https://x.example.com' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.candidateLink.count).toHaveBeenCalledWith({
        where: { candidateAccountId: MY_ACCOUNT },
      });
    });

    it('takes a row lock before counting so two requests cannot both pass', async () => {
      const { service, prisma } = build();
      prisma.candidateLink.count.mockResolvedValue(0);
      prisma.candidateLink.create.mockResolvedValue(linkRow());

      await service.create(ME, { url: 'https://portfolio.example.com' });
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it('reports the remaining slots to the UI', async () => {
      const { service, prisma } = build();
      prisma.candidateLink.findMany.mockResolvedValue([linkRow()]);

      const result = await service.list(ME);
      expect(result).toMatchObject({
        limit: MAX_CANDIDATE_LINKS,
        remaining: 2,
      });
    });
  });

  describe('duplicate detection', () => {
    it('rejects a URL that normalizes to an existing one', async () => {
      const { service, prisma } = build();
      prisma.candidateLink.count.mockResolvedValue(1);
      // The unique index is the authority; the service maps it to a typed 409.
      prisma.candidateLink.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create(ME, { url: 'https://www.portfolio.example.com/' }),
      ).rejects.toMatchObject({
        response: { code: LINK_ERROR_CODES.LINK_DUPLICATE },
      });
    });

    it('stores the canonical identity, not the raw input', async () => {
      const { service, prisma } = build();
      prisma.candidateLink.create.mockResolvedValue(linkRow());

      await service.create(ME, {
        url: 'HTTPS://WWW.Portfolio.example.com/?utm_source=x#top',
      });

      expect(prisma.candidateLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            normalizedUrl: 'portfolio.example.com',
          }),
        }),
      );
    });
  });

  describe('URL validation', () => {
    it.each([
      'http://localhost/admin',
      'file:///etc/passwd',
      'http://169.254.169.254/latest/meta-data/',
      'https://api.internal/v1',
      'http://example.com:6379/',
    ])('rejects %s before anything is written', async (url) => {
      const { service, prisma } = build();
      await expect(service.create(ME, { url })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.candidateLink.create).not.toHaveBeenCalled();
    });

    it('reports WHY a target was refused without echoing the URL', async () => {
      const { service } = build();
      await expect(
        service.create(ME, { url: 'http://169.254.169.254/' }),
      ).rejects.toMatchObject({
        response: {
          code: LINK_ERROR_CODES.LINK_INVALID_URL,
          failureCode: LinkFailureCode.PRIVATE_NETWORK_URL,
        },
      });
    });
  });

  describe('ownership', () => {
    it('cannot read, edit, delete or refresh another candidate’s link', async () => {
      const { service, prisma } = build();
      // Scoped lookup returns nothing for a foreign id — indistinguishable
      // from an id that never existed.
      prisma.candidateLink.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ME, 'link-of-someone-else', {
          url: 'https://a.example.com',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(service.remove(ME, 'link-of-someone-else')).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.reprocess(ME, 'link-of-someone-else'),
      ).rejects.toThrow(NotFoundException);
    });

    it('always scopes the lookup by the caller’s own account', async () => {
      const { service, prisma } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(linkRow());

      await service.remove(ME, 'link-1');
      expect(prisma.candidateLink.findFirst).toHaveBeenCalledWith({
        where: { id: 'link-1', candidateAccountId: MY_ACCOUNT },
      });
    });

    it('404s when the caller has no candidate account at all', async () => {
      const { service, prisma } = build();
      prisma.candidateAccount.findUnique.mockResolvedValue(null);
      await expect(service.list(ME)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleting a link', () => {
    it('runs the full cascade for the caller’s own link', async () => {
      const { service, prisma, evidence } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(linkRow());

      await expect(service.remove(ME, 'link-1')).resolves.toEqual({
        id: 'link-1',
        deleted: true,
      });
      expect(evidence.cascadePersonalLinkDeletion).toHaveBeenCalledWith(
        MY_ACCOUNT,
        'link-1',
      );
    });

    it('REMOVES the submitted snapshots too — the candidate owns this evidence', async () => {
      // This is the product rule that changed. A link the candidate deletes
      // stops existing for the organizations they sent it to as well: the
      // cascade is not optional, and there is no path here that deletes the
      // personal row while leaving an organization's copy behind.
      const { service, prisma, evidence } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(linkRow());

      await service.remove(ME, 'link-1');

      expect(evidence.cascadePersonalLinkDeletion).toHaveBeenCalledTimes(1);
      // The service must NOT delete the row itself: doing so outside the
      // cascade's transaction would orphan the derived copies.
      expect(prisma.candidateLink.delete).not.toHaveBeenCalled();
    });

    it('refuses before cascading when the link is not the caller’s', async () => {
      const { service, prisma, evidence } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(null);

      await expect(service.remove(ME, 'link-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(evidence.cascadePersonalLinkDeletion).not.toHaveBeenCalled();
    });
  });

  describe('editing a link', () => {
    it('renames without re-fetching when the URL is unchanged', async () => {
      const { service, prisma, producer } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(linkRow());
      prisma.candidateLink.update.mockResolvedValue(
        linkRow({ title: 'My site' }),
      );

      await service.update(ME, 'link-1', {
        url: 'https://portfolio.example.com/',
        title: 'My site',
      });

      expect(prisma.candidateLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { title: 'My site' },
        select: expect.anything(),
      });
      expect(producer.enqueueCandidateLink).not.toHaveBeenCalled();
    });

    it('treats a changed URL as a different source and starts over', async () => {
      const { service, prisma, producer } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(linkRow());
      prisma.candidateLink.update.mockResolvedValue(
        linkRow({ status: LinkStatus.PENDING }),
      );

      await service.update(ME, 'link-1', { url: 'https://new.example.com' });

      // Old content and failure state are cleared: keeping the previous text
      // under a new URL would make every citation from it a lie.
      expect(prisma.candidateLink.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LinkStatus.PENDING,
            contentHash: null,
            failureCode: null,
          }),
        }),
      );
      expect(producer.enqueueCandidateLinkIndexDeletion).toHaveBeenCalled();
      expect(producer.enqueueCandidateLink).toHaveBeenCalledWith(
        { linkId: 'link-1', candidateAccountId: MY_ACCOUNT },
        { replaceExisting: true },
      );
    });

    it('withdraws the submitted copies of the address being replaced', async () => {
      const { service, prisma, evidence } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(linkRow());
      prisma.candidateLink.update.mockResolvedValue(
        linkRow({ status: LinkStatus.PENDING }),
      );

      await service.update(ME, 'link-1', { url: 'https://new.example.com' });

      expect(evidence.cascadeDerivedCopyRemoval).toHaveBeenCalledWith(
        MY_ACCOUNT,
        { linkId: 'link-1' },
      );
    });

    it('a RENAME withdraws nothing — the evidence is the same page', async () => {
      const { service, prisma, evidence } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(linkRow());
      prisma.candidateLink.update.mockResolvedValue(
        linkRow({ title: 'My site' }),
      );

      await service.update(ME, 'link-1', {
        url: 'https://portfolio.example.com/',
        title: 'My site',
      });

      expect(evidence.cascadeDerivedCopyRemoval).not.toHaveBeenCalled();
    });
  });

  describe('retry and refresh', () => {
    it('re-queues a transient failure', async () => {
      const { service, prisma, producer } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(
        linkRow({
          status: LinkStatus.FAILED,
          failureCode: LinkFailureCode.FETCH_TIMEOUT,
        }),
      );
      prisma.candidateLink.update.mockResolvedValue(
        linkRow({ status: LinkStatus.PENDING }),
      );

      await service.reprocess(ME, 'link-1');
      expect(producer.enqueueCandidateLink).toHaveBeenCalled();
    });

    it.each([
      LinkFailureCode.PRIVATE_NETWORK_URL,
      LinkFailureCode.UNSUPPORTED_PROTOCOL,
      LinkFailureCode.INVALID_URL,
      LinkFailureCode.ACCESS_DENIED,
      LinkFailureCode.NO_MEANINGFUL_CONTENT,
    ])('refuses to retry a permanent failure (%s)', async (failureCode) => {
      const { service, prisma, producer } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(
        linkRow({ status: LinkStatus.FAILED, failureCode }),
      );

      await expect(service.reprocess(ME, 'link-1')).rejects.toMatchObject({
        response: { code: LINK_ERROR_CODES.LINK_NOT_RETRYABLE },
      });
      expect(producer.enqueueCandidateLink).not.toHaveBeenCalled();
    });

    it('allows retrying CONTENT_TOO_LARGE — page weight is a state, not a verdict', async () => {
      const { service, prisma, producer } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(
        linkRow({
          status: LinkStatus.FAILED,
          failureCode: LinkFailureCode.CONTENT_TOO_LARGE,
        }),
      );
      prisma.candidateLink.update.mockResolvedValue(
        linkRow({ status: LinkStatus.PENDING }),
      );

      await service.reprocess(ME, 'link-1');
      expect(producer.enqueueCandidateLink).toHaveBeenCalled();
    });

    it('refuses while a job is genuinely still running', async () => {
      const producer = createProducerMock();
      producer.hasLiveLinkJob.mockResolvedValue(true);
      const { service, prisma } = build({ producer });
      prisma.candidateLink.findFirst.mockResolvedValue(
        linkRow({ status: LinkStatus.FETCHING }),
      );

      await expect(service.reprocess(ME, 'link-1')).rejects.toMatchObject({
        response: { code: LINK_ERROR_CODES.LINK_BUSY },
      });
    });

    it('allows recovery from a status stranded by a dead worker', async () => {
      const { service, prisma, producer } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(
        linkRow({ status: LinkStatus.PROCESSING }),
      );
      prisma.candidateLink.update.mockResolvedValue(linkRow());

      await service.reprocess(ME, 'link-1');
      expect(producer.enqueueCandidateLink).toHaveBeenCalled();
    });

    it('refreshes a COMPLETED link on request', async () => {
      const { service, prisma, producer } = build();
      prisma.candidateLink.findFirst.mockResolvedValue(linkRow());
      prisma.candidateLink.update.mockResolvedValue(linkRow());

      await service.reprocess(ME, 'link-1');
      expect(producer.enqueueCandidateLink).toHaveBeenCalled();
    });
  });

  describe('what apply may submit', () => {
    it('offers only COMPLETED links that actually have content', async () => {
      const { service, prisma } = build();
      await service.listSubmittableLinks(MY_ACCOUNT);

      const where = prisma.candidateLink.findMany.mock.calls[0][0].where;
      expect(where.status).toBe(LinkStatus.COMPLETED);
      expect(where.candidateAccountId).toBe(MY_ACCOUNT);
      expect(where.sections).toBeDefined();
    });

    it('never offers more than the link limit', async () => {
      const { service, prisma } = build();
      await service.listSubmittableLinks(MY_ACCOUNT);
      expect(prisma.candidateLink.findMany.mock.calls[0][0].take).toBe(
        MAX_CANDIDATE_LINKS,
      );
    });
  });

  describe('response shape', () => {
    it('never exposes the extracted text or the normalized identity', async () => {
      const { service, prisma } = build();
      prisma.candidateLink.findMany.mockResolvedValue([linkRow()]);

      const result = await service.list(ME);
      expect(result.data[0]).not.toHaveProperty('sections');
      expect(result.data[0]).not.toHaveProperty('normalizedUrl');
    });

    it('falls back to the hostname while a link has no title yet', async () => {
      const { service, prisma } = build();
      prisma.candidateLink.findMany.mockResolvedValue([
        linkRow({ title: null, status: LinkStatus.PENDING }),
      ]);

      const result = await service.list(ME);
      expect(result.data[0].title).toBe('portfolio.example.com');
    });
  });
});
