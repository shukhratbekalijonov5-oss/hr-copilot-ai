import { CandidateEvidenceLifecycleService } from './candidate-evidence.service';

/**
 * The cascade is the heart of the product rule "a candidate owns their
 * evidence", so it is tested directly rather than only through its callers.
 *
 * What these tests care about, in order of importance:
 *  1. a deleted source disappears from EVERY organization it was sent to;
 *  2. an unrelated source is never touched;
 *  3. the APPLICATION survives;
 *  4. the derived AI artifacts are invalidated, not left pointing at nothing;
 *  5. a storage or Qdrant failure never turns a completed deletion into an
 *     error, because the authoritative state has already changed.
 */

const ACCOUNT = 'acct-me';

function createPrismaMock(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    document: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    applicationLinkSource: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    candidateLink: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    requirementEvidenceMap: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    candidateAccount: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ evidenceRevision: 3 }),
    },
    ...overrides,
  };
  prisma.$transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg)
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

function build(overrides: { prisma?: any; storage?: any; ai?: any } = {}) {
  const prisma = overrides.prisma ?? createPrismaMock();
  const storage = overrides.storage ?? {
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const producer = {
    enqueuePersonalResumeIndexDeletion: jest.fn().mockResolvedValue('job-1'),
    enqueueCandidateLinkIndexDeletion: jest.fn().mockResolvedValue('job-2'),
  };
  const ai = overrides.ai ?? {
    enabled: true,
    deleteDocument: jest.fn().mockResolvedValue(undefined),
    deletePersonalResume: jest.fn().mockResolvedValue(undefined),
    deletePersonalWebSource: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CandidateEvidenceLifecycleService(
    prisma as never,
    storage as never,
    producer as never,
    ai as never,
  );
  return { service, prisma, storage, producer, ai };
}

const orgCopy = (id: string, org: string, candidate: string) => ({
  id,
  organizationId: org,
  candidateId: candidate,
  storageKey: `org/${org}/${id}.pdf`,
});

describe('CandidateEvidenceLifecycleService', () => {
  describe('what counts as evidence', () => {
    it('counts files and links independently, never as one pooled budget', async () => {
      const prisma = createPrismaMock();
      prisma.document.count.mockResolvedValue(2);
      prisma.candidateLink.count.mockResolvedValue(1);
      const { service } = build({ prisma });

      await expect(service.activeSourceCounts(ACCOUNT)).resolves.toEqual({
        files: 2,
        links: 1,
        total: 3,
      });
    });

    it('counts only PERSONAL files — an organization copy is not the candidate’s', async () => {
      const prisma = createPrismaMock();
      const { service } = build({ prisma });

      await service.activeSourceCounts(ACCOUNT);

      expect(prisma.document.count).toHaveBeenCalledWith({
        where: { candidateAccountId: ACCOUNT, organizationId: null },
      });
    });

    it('returns zero for an account with nothing — the job-match gate’s input', async () => {
      const { service } = build();
      await expect(service.activeSourceCounts(ACCOUNT)).resolves.toMatchObject({
        total: 0,
      });
    });
  });

  describe('the retrieval allowlist', () => {
    it('lists a candidate’s files and links in ONE key space', async () => {
      const prisma = createPrismaMock();
      prisma.document.findMany.mockResolvedValue([{ id: 'doc-1' }]);
      prisma.candidateLink.findMany.mockResolvedValue([{ id: 'link-1' }]);
      const { service } = build({ prisma });

      await expect(service.activePersonalSourceIds(ACCOUNT)).resolves.toEqual([
        'doc-1',
        'link-1',
      ]);
    });

    it('scopes an organization’s allowlist by BOTH organization and candidate', async () => {
      const prisma = createPrismaMock();
      const { service } = build({ prisma });

      await service.activeApplicationSourceIds('org-1', 'cand-1');

      // A filter that leaked ids across tenants would be worse than none.
      expect(prisma.document.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', candidateId: 'cand-1' },
        select: { id: true },
      });
      expect(prisma.applicationLinkSource.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', candidateId: 'cand-1' },
        select: { id: true },
      });
    });

    it('returns an EMPTY list when nothing survives, not a missing filter', async () => {
      // Empty and absent mean opposite things downstream: empty is "read
      // nothing", absent is "read everything".
      const { service } = build();
      await expect(
        service.activeApplicationSourceIds('org-1', 'cand-1'),
      ).resolves.toEqual([]);
    });
  });

  describe('deleting a personal FILE', () => {
    it('removes every organization copy derived from it', async () => {
      const prisma = createPrismaMock();
      prisma.document.findMany.mockResolvedValue([
        orgCopy('copy-a', 'org-1', 'cand-1'),
        orgCopy('copy-b', 'org-2', 'cand-2'),
      ]);
      const { service, ai } = build({ prisma });

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      expect(prisma.document.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['copy-a', 'copy-b'] } },
      });
      // ...in every organization, each in its own tenant collection.
      expect(ai.deleteDocument).toHaveBeenCalledWith('org-1', 'copy-a');
      expect(ai.deleteDocument).toHaveBeenCalledWith('org-2', 'copy-b');
    });

    it('finds those copies by LINEAGE, not by name or by candidate', async () => {
      const prisma = createPrismaMock();
      const { service } = build({ prisma });

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sourceCandidateDocumentId: 'doc-1',
            organizationId: { not: null },
          },
        }),
      );
    });

    it('leaves the APPLICATION alone — only the evidence is withdrawn', async () => {
      const prisma = createPrismaMock();
      prisma.document.findMany.mockResolvedValue([
        orgCopy('copy-a', 'org-1', 'cand-1'),
      ]);
      const { service } = build({ prisma });

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      // No application table access at all: status, chat and history survive.
      expect(prisma.application).toBeUndefined();
    });

    it('invalidates the requirement mappings built on the removed copies', async () => {
      const prisma = createPrismaMock();
      prisma.document.findMany.mockResolvedValue([
        orgCopy('copy-a', 'org-1', 'cand-1'),
      ]);
      const { service } = build({ prisma });

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      // Otherwise "Kubernetes — EVIDENCE_FOUND" would survive with nothing
      // behind it, and a recruiter would read a verdict whose proof is gone.
      expect(prisma.requirementEvidenceMap.deleteMany).toHaveBeenCalledWith({
        where: { candidateId: { in: ['cand-1'] } },
      });
    });

    it('invalidates NOTHING when the file was never submitted anywhere', async () => {
      const { service, prisma } = build();

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      expect(prisma.requirementEvidenceMap.deleteMany).not.toHaveBeenCalled();
    });

    it('bumps the evidence revision so an in-flight match is recognised as stale', async () => {
      const { service, prisma } = build();

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      expect(prisma.candidateAccount.update).toHaveBeenCalledWith({
        where: { id: ACCOUNT },
        data: { evidenceRevision: { increment: 1 } },
      });
    });

    it('repoints the primary resume inside the same transaction', async () => {
      const prisma = createPrismaMock();
      prisma.document.findFirst.mockResolvedValue({ id: 'doc-survivor' });
      const { service } = build({ prisma });

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1', {
        repointResumeTo: 'newest',
      });

      expect(prisma.candidateAccount.update).toHaveBeenCalledWith({
        where: { id: ACCOUNT },
        data: { resumeDocumentId: 'doc-survivor' },
      });
    });

    it('clears the pointer when nothing survives', async () => {
      const prisma = createPrismaMock();
      prisma.document.findFirst.mockResolvedValue(null);
      const { service } = build({ prisma });

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1', {
        repointResumeTo: 'newest',
      });

      expect(prisma.candidateAccount.update).toHaveBeenCalledWith({
        where: { id: ACCOUNT },
        data: { resumeDocumentId: null },
      });
    });
  });

  describe('deleting a personal LINK', () => {
    it('removes every submitted snapshot copied from it', async () => {
      const prisma = createPrismaMock();
      prisma.applicationLinkSource.findMany.mockResolvedValue([
        { id: 'src-a', organizationId: 'org-1', candidateId: 'cand-1' },
        { id: 'src-b', organizationId: 'org-2', candidateId: 'cand-2' },
      ]);
      const { service, ai } = build({ prisma });

      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');

      expect(prisma.applicationLinkSource.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['src-a', 'src-b'] } },
      });
      expect(ai.deleteDocument).toHaveBeenCalledWith('org-1', 'src-a');
      expect(ai.deleteDocument).toHaveBeenCalledWith('org-2', 'src-b');
    });

    it('finds them by sourceLinkId — the link’s own lineage column', async () => {
      const prisma = createPrismaMock();
      const { service } = build({ prisma });

      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');

      expect(prisma.applicationLinkSource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sourceLinkId: 'link-1' } }),
      );
    });

    it('deletes the personal row scoped to its owner', async () => {
      const { service, prisma } = build();

      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');

      expect(prisma.candidateLink.deleteMany).toHaveBeenCalledWith({
        where: { id: 'link-1', candidateAccountId: ACCOUNT },
      });
    });

    it('evicts the personal vectors through the queue', async () => {
      const { service, producer } = build();

      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');

      expect(producer.enqueueCandidateLinkIndexDeletion).toHaveBeenCalledWith({
        linkId: 'link-1',
        candidateAccountId: ACCOUNT,
      });
    });
  });

  describe('re-pointing a link at a different URL', () => {
    it('withdraws the submitted copies of the OLD address, keeping the row', async () => {
      const prisma = createPrismaMock();
      prisma.applicationLinkSource.findMany.mockResolvedValue([
        { id: 'src-a', organizationId: 'org-1', candidateId: 'cand-1' },
      ]);
      const { service } = build({ prisma });

      await service.cascadeDerivedCopyRemoval(ACCOUNT, { linkId: 'link-1' });

      expect(prisma.applicationLinkSource.deleteMany).toHaveBeenCalled();
      // The personal link itself stays: the candidate is editing it, not
      // deleting it.
      expect(prisma.candidateLink.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('when cleanup fails, the deletion still stands', () => {
    it('reports success even if the organization vectors cannot be evicted', async () => {
      const prisma = createPrismaMock();
      prisma.document.findMany.mockResolvedValue([
        orgCopy('copy-a', 'org-1', 'cand-1'),
      ]);
      const ai = {
        enabled: true,
        deleteDocument: jest.fn().mockRejectedValue(new Error('qdrant down')),
        deletePersonalResume: jest.fn().mockResolvedValue(undefined),
        deletePersonalWebSource: jest.fn().mockResolvedValue(undefined),
      };
      const { service } = build({ prisma, ai });

      // The rows are already gone, and retrieval is authorized against rows —
      // so the surviving vectors are unreachable, not dangerous.
      await expect(
        service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1'),
      ).resolves.toBeUndefined();
    });

    it('reports success even if an organization’s bytes cannot be removed', async () => {
      const prisma = createPrismaMock();
      prisma.document.findMany.mockResolvedValue([
        orgCopy('copy-a', 'org-1', 'cand-1'),
      ]);
      const storage = {
        delete: jest.fn().mockRejectedValue(new Error('r2 unreachable')),
      };
      const { service } = build({ prisma, storage });

      await expect(
        service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1'),
      ).resolves.toBeUndefined();
    });

    it('falls back to an inline eviction when the queue is down', async () => {
      const { service, producer, ai } = build();
      producer.enqueueCandidateLinkIndexDeletion.mockRejectedValue(
        new Error('redis down'),
      );

      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');

      expect(ai.deletePersonalWebSource).toHaveBeenCalledWith(
        ACCOUNT,
        'link-1',
      );
    });

    it('does not call a disabled AI service at all', async () => {
      const prisma = createPrismaMock();
      prisma.document.findMany.mockResolvedValue([
        orgCopy('copy-a', 'org-1', 'cand-1'),
      ]);
      const ai = {
        enabled: false,
        deleteDocument: jest.fn(),
        deletePersonalResume: jest.fn(),
        deletePersonalWebSource: jest.fn(),
      };
      const { service } = build({ prisma, ai });

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      expect(ai.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('a repeated delete is harmless — deleteMany matches nothing', async () => {
      const { service, prisma } = build();

      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');
      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');

      expect(prisma.candidateLink.deleteMany).toHaveBeenCalledTimes(2);
      // No throw, no partial state: every write is a match-and-remove.
    });
  });

  describe('the evidence revision', () => {
    it('increments on demand', async () => {
      const { service, prisma } = build();
      await service.bumpRevision(ACCOUNT);

      expect(prisma.candidateAccount.update).toHaveBeenCalledWith({
        where: { id: ACCOUNT },
        data: { evidenceRevision: { increment: 1 } },
      });
    });

    it('never throws — a missed bump must not fail a real evidence change', async () => {
      const prisma = createPrismaMock();
      prisma.candidateAccount.update.mockRejectedValue(new Error('db blip'));
      const { service } = build({ prisma });

      await expect(service.bumpRevision(ACCOUNT)).resolves.toBeUndefined();
    });

    it('reads as 0 for an account that does not exist', async () => {
      const prisma = createPrismaMock();
      prisma.candidateAccount.findUnique.mockResolvedValue(null);
      const { service } = build({ prisma });

      await expect(service.revision(ACCOUNT)).resolves.toBe(0);
    });
  });
});
