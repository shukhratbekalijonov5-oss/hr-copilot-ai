import { CandidateEvidenceLifecycleService } from './candidate-evidence.service';

/**
 * The cascade is the heart of the product rule "a candidate owns their
 * evidence", so it is tested directly rather than only through its callers.
 *
 * Since the snapshot removal there is exactly ONE copy of a candidate's
 * evidence, so "disappears from every organization" is now enforced by the
 * database: CandidateEvidence cites the personal document / candidate link
 * with ON DELETE CASCADE, and deleting the row takes every stored citation of
 * it — in every organization — with it. What this service still owns is what
 * a foreign key cannot do.
 *
 * What these tests care about, in order of importance:
 *  1. the personal row is deleted, scoped to its owner (the FK cascade then
 *     withdraws the evidence everywhere);
 *  2. the derived AI VERDICTS are invalidated, not left pointing at nothing;
 *  3. an unrelated source is never touched;
 *  4. the APPLICATION survives;
 *  5. a queue or Qdrant failure never turns a completed deletion into an
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
    candidateEvidence: {
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

function build(overrides: { prisma?: any; ai?: any } = {}) {
  const prisma = overrides.prisma ?? createPrismaMock();
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
    producer as never,
    ai as never,
  );
  return { service, prisma, producer, ai };
}


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

    it('scopes the allowlist to the account, and to PERSONAL rows only', async () => {
      const prisma = createPrismaMock();
      const { service } = build({ prisma });

      await service.activePersonalSourceIds(ACCOUNT);

      // There is one allowlist now, because there is one copy of the
      // evidence. `organizationId: null` keeps a historical organization
      // document from ever entering a candidate's own source list.
      expect(prisma.document.findMany).toHaveBeenCalledWith({
        where: { candidateAccountId: ACCOUNT, organizationId: null },
        select: { id: true },
      });
      expect(prisma.candidateLink.findMany).toHaveBeenCalledWith({
        where: { candidateAccountId: ACCOUNT },
        select: { id: true },
      });
    });

    it('returns an EMPTY list when nothing survives, not a missing filter', async () => {
      // Empty and absent mean opposite things downstream: empty is "read
      // nothing", absent is "read everything".
      const { service } = build();
      await expect(service.activePersonalSourceIds(ACCOUNT)).resolves.toEqual(
        [],
      );
    });
  });

  describe('deleting a personal FILE', () => {
    it('deletes the personal row scoped to its owner', async () => {
      const { service, prisma } = build();

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      // The account scope is what stops one person's delete removing
      // another's file if an id were ever substituted upstream. The row going
      // is what withdraws the evidence: its stored citations cascade with it,
      // in every organization, in the same statement.
      expect(prisma.document.deleteMany).toHaveBeenCalledWith({
        where: { id: 'doc-1', candidateAccountId: ACCOUNT },
      });
    });

    it('makes NO organization-side copy deletion — there are none to make', async () => {
      const { service, prisma, ai } = build();

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      // Applying copies nothing, so nothing derived exists to hunt down by
      // lineage. A lookup here would be dead code hiding a resurrected model.
      expect(prisma.document.findMany).not.toHaveBeenCalled();
      expect(ai.deleteDocument).not.toHaveBeenCalled();
    });

    it('evicts the PERSONAL vectors through the queue', async () => {
      const { service, producer } = build();

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      expect(producer.enqueuePersonalResumeIndexDeletion).toHaveBeenCalledWith(
        { documentId: 'doc-1', candidateAccountId: ACCOUNT },
      );
    });

    it('leaves the APPLICATION alone — only the evidence is withdrawn', async () => {
      const { service, prisma } = build();

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      // No application table access at all: status, chat and history survive.
      expect(prisma.application).toBeUndefined();
    });

    it('invalidates the requirement verdicts derived from this account', async () => {
      const { service, prisma } = build();

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      // The citations cascade away with the row, but the VERDICT would not:
      // "Kubernetes — EVIDENCE_FOUND" must not survive with nothing behind
      // it, in any organization this person applied to.
      expect(prisma.requirementEvidenceMap.deleteMany).toHaveBeenCalledWith({
        where: { candidate: { candidateAccountId: ACCOUNT } },
      });
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
    it('invalidates the verdicts derived from this account', async () => {
      const { service, prisma } = build();

      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');

      expect(prisma.requirementEvidenceMap.deleteMany).toHaveBeenCalledWith({
        where: { candidate: { candidateAccountId: ACCOUNT } },
      });
    });

    it('makes NO organization-side snapshot deletion — there are none', async () => {
      const { service, ai } = build();

      await service.cascadePersonalLinkDeletion(ACCOUNT, 'link-1');

      expect(ai.deleteDocument).not.toHaveBeenCalled();
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
    it('withdraws the citations of the OLD address, keeping the row', async () => {
      const { service, prisma } = build();

      await service.cascadeDerivedCopyRemoval(ACCOUNT, { linkId: 'link-1' });

      // The row survives an edit, so no foreign key fires — the stored
      // citations of the address the candidate no longer claims have to be
      // removed explicitly, or a recruiter would keep reading passages from
      // a page that is no longer this person's evidence.
      expect(prisma.candidateEvidence.deleteMany).toHaveBeenCalledWith({
        where: { candidateLinkId: 'link-1' },
      });
      expect(prisma.requirementEvidenceMap.deleteMany).toHaveBeenCalled();
      // The personal link itself stays: the candidate is editing it, not
      // deleting it.
      expect(prisma.candidateLink.deleteMany).not.toHaveBeenCalled();
    });

    it('withdraws NO citations when a FILE is merely re-processed', async () => {
      const { service, prisma } = build();

      await service.cascadeDerivedCopyRemoval(ACCOUNT, { fileId: 'doc-1' });

      // A file keeps its id across a reprocess, and its chunks are replaced
      // in place — the citations still point at real, current passages.
      expect(prisma.candidateEvidence.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('when cleanup fails, the deletion still stands', () => {
    it('reports success even if the personal vectors cannot be evicted', async () => {
      const ai = {
        enabled: true,
        deleteDocument: jest.fn(),
        deletePersonalResume: jest
          .fn()
          .mockRejectedValue(new Error('qdrant down')),
        deletePersonalWebSource: jest.fn().mockResolvedValue(undefined),
      };
      const { service, producer } = build({ ai });
      producer.enqueuePersonalResumeIndexDeletion.mockRejectedValue(
        new Error('redis down'),
      );

      // The rows are already gone, and retrieval is authorized against rows —
      // so the surviving vectors are unreachable, not dangerous.
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
      const ai = {
        enabled: false,
        deleteDocument: jest.fn(),
        deletePersonalResume: jest.fn(),
        deletePersonalWebSource: jest.fn(),
      };
      const { service, producer } = build({ ai });
      producer.enqueuePersonalResumeIndexDeletion.mockRejectedValue(
        new Error('redis down'),
      );

      await service.cascadePersonalFileDeletion(ACCOUNT, 'doc-1');

      expect(ai.deletePersonalResume).not.toHaveBeenCalled();
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
