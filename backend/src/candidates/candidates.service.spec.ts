import { NotFoundException } from '@nestjs/common';
import { CandidatesService } from './candidates.service';
import { TenantService } from '../common/tenant/tenant.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import type { StorageService } from '../storage/storage.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function createPrismaMock() {
  const mock = {
    candidate: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findUniqueOrThrow: jest.fn(),
    },
    document: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    candidateLink: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(
    (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof arg === 'function' ? arg(mock) : Promise.all(arg),
  );
  return mock;
}

function createOwnedVacanciesMock() {
  return {
    requireOwned: jest.fn().mockResolvedValue({ id: 'vac-1' }),
    assertCandidateInVacancy: jest.fn().mockResolvedValue(undefined),
  };
}

function createStorageMock() {
  return {
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/url'),
  };
}

describe('CandidatesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let ownedVacancies: ReturnType<typeof createOwnedVacanciesMock>;
  let storage: ReturnType<typeof createStorageMock>;
  let service: CandidatesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    ownedVacancies = createOwnedVacanciesMock();
    storage = createStorageMock();
    service = new CandidatesService(
      prisma as unknown as PrismaService,
      new TenantService(),
      ownedVacancies as unknown as OwnedVacancyService,
      storage as unknown as StorageService,
    );
  });

  it('exposes no way to create a candidate', () => {
    // HR-side candidate creation was removed from the product: a Candidate
    // row exists only because a person applied.
    expect(
      (service as unknown as Record<string, unknown>).create,
    ).toBeUndefined();
  });

  describe('findAll — tenant isolation', () => {
    beforeEach(() => {
      prisma.candidate.findMany.mockResolvedValue([]);
      prisma.candidate.count.mockResolvedValue(0);
    });

    it('constrains every list query to the caller organization', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      expect(
        prisma.candidate.findMany.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });

    it('lists APPLICANTS only — never a leftover recruiter-created record', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      expect(
        prisma.candidate.findMany.mock.calls[0][0].where.candidateAccountId,
      ).toEqual({ not: null });
    });

    it('keeps the tenant filter alongside a metadata search', async () => {
      await service.findAll(ORG_A, {
        page: 1,
        limit: 20,
        skip: 0,
        search: 'engineer',
        minExperienceYears: 5,
      });

      const where = prisma.candidate.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      expect(where.totalExperienceYears).toEqual({ gte: 5 });
      expect(where.OR).toHaveLength(3);
    });

    it('applies pagination offsets', async () => {
      await service.findAll(ORG_A, { page: 3, limit: 10, skip: 20 });

      const args = prisma.candidate.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });
  });

  describe('findOne — one evidence truth', () => {
    it('returns applications and LIVE identity, and no evidence at all', async () => {
      // There is nothing to collapse any more: applying copies nothing, so one
      // logical resume is one row under the candidate's own account. Candidate
      // Detail therefore carries no document or link list — a bare candidate id
      // must never become a general-purpose way to read someone's evidence.
      // That is reached only through getCurrentEvidence, which re-verifies the
      // owned-vacancy + applicant chain on every request.
      prisma.candidate.findFirst.mockResolvedValue({
        id: 'c1',
        fullName: 'Org Side Name',
        email: 'org@example.test',
        candidateAccount: null,
      });

      await service.findOne(ORG_A, 'c1');

      const include = prisma.candidate.findFirst.mock.calls[0][0].include;
      expect(include.documents).toBeUndefined();
      expect(include.linkSources).toBeUndefined();
      expect(include.applications).toBeDefined();
      // The account is read for the person's CURRENT name, email and avatar.
      expect(include.candidateAccount.select.user.select).toMatchObject({
        fullName: true,
        email: true,
        avatarStorageKey: true,
      });
    });

    it('prefers the LIVE account identity over the org-side record', async () => {
      prisma.candidate.findFirst.mockResolvedValue({
        id: 'c1',
        fullName: 'Stale Copy',
        email: 'stale@example.test',
        candidateAccount: {
          user: {
            fullName: 'Renamed Person',
            email: 'renamed@example.test',
            avatarStorageKey: null,
          },
          personalDocuments: [{ status: 'COMPLETED' }],
        },
      });

      const result = (await service.findOne(ORG_A, 'c1')) as {
        fullName: string;
        email: string;
        documentCount: number;
      };

      // Someone who corrects their name after applying is reachable under the
      // value that is true now — the org-side row is not an address book.
      expect(result.fullName).toBe('Renamed Person');
      expect(result.email).toBe('renamed@example.test');
      expect(result.documentCount).toBe(1);
    });
  });

  describe('findOne / update / remove — tenant isolation', () => {
    it('404s for a candidate belonging to another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_B, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('will not update across tenants', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ORG_B, 'c1', { fullName: 'Overwritten' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.candidate.update).not.toHaveBeenCalled();
    });

    it('will not delete across tenants', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG_B, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.candidate.delete).not.toHaveBeenCalled();
    });

    it('reads/edits are applicant-scoped, not merely tenant-scoped', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_A, 'c-manual')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.candidate.findFirst.mock.calls[0][0].where).toMatchObject({
        organizationId: ORG_A,
        candidateAccountId: { not: null },
      });
    });

    it('permits access within the owning organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: ORG_A,
      });
      prisma.candidate.update.mockResolvedValue({ id: 'c1' });

      await expect(
        service.update(ORG_A, 'c1', { location: 'Tashkent, UZ' }),
      ).resolves.toEqual({ id: 'c1' });
    });
  });
  describe('getCurrentEvidence — live applicant data behind the vacancy chain', () => {
    const CALLER = 'user-hr';
    const ACCOUNT = { id: 'acct-1', userId: 'user-cand' };

    function armHappyPath() {
      prisma.candidate.findFirst.mockResolvedValue({
        candidateAccount: ACCOUNT,
      });
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        fullName: 'Current Name',
        email: 'current@example.test',
        avatarStorageKey: 'avatars/u1.webp',
      });
      prisma.document.findMany.mockResolvedValue([]);
      prisma.candidateLink.findMany.mockResolvedValue([]);
    }

    it('runs the FULL chain: owned vacancy, then applicant, then live read', async () => {
      armHappyPath();
      await service.getCurrentEvidence(CALLER, ORG_A, 'c1', 'vac-1');

      expect(ownedVacancies.requireOwned).toHaveBeenCalledWith(
        CALLER,
        ORG_A,
        'vac-1',
      );
      expect(ownedVacancies.assertCandidateInVacancy).toHaveBeenCalledWith(
        'vac-1',
        'c1',
      );
      // The candidate lookup itself is still tenant- and applicant-scoped.
      expect(prisma.candidate.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'c1',
        organizationId: ORG_A,
        candidateAccountId: { not: null },
      });
    });

    it('returns the CURRENT name/email/avatar from the live user row', async () => {
      armHappyPath();
      const result = await service.getCurrentEvidence(
        CALLER,
        ORG_A,
        'c1',
        'vac-1',
      );

      expect(result.candidate).toEqual({
        id: 'c1',
        fullName: 'Current Name',
        email: 'current@example.test',
        avatarUrl: 'https://signed.example/url',
      });
      // Live means: read by the ACCOUNT's user id, never from the org-side copy.
      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ACCOUNT.userId } }),
      );
    });

    it('reads ALL current personal documents and links by account id, org NULL', async () => {
      armHappyPath();
      prisma.document.findMany.mockResolvedValue([
        d('d1', 'Resume.pdf'),
        d('d2', 'Portfolio.pdf'),
        d('d3', 'Extra.docx'),
      ]);
      prisma.candidateLink.findMany.mockResolvedValue([
        l('l1'),
        l('l2'),
        l('l3'),
      ]);

      const result = await service.getCurrentEvidence(
        CALLER,
        ORG_A,
        'c1',
        'vac-1',
      );

      expect(prisma.document.findMany.mock.calls[0][0].where).toEqual({
        candidateAccountId: ACCOUNT.id,
        organizationId: null,
      });
      expect(prisma.candidateLink.findMany.mock.calls[0][0].where).toEqual({
        candidateAccountId: ACCOUNT.id,
      });
      expect(result.documents).toHaveLength(3);
      expect(result.professionalLinks).toHaveLength(3);
      // No private implementation metadata escapes.
      for (const doc of result.documents) {
        expect(doc).not.toHaveProperty('storageKey');
      }
    });

    it('propagates an unowned vacancy instead of reading anything', async () => {
      ownedVacancies.requireOwned.mockRejectedValue(
        new NotFoundException('Vacancy not found'),
      );
      await expect(
        service.getCurrentEvidence(CALLER, ORG_A, 'c1', 'vac-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.candidate.findFirst).not.toHaveBeenCalled();
    });

    it('propagates a missing application (candidate never applied here)', async () => {
      ownedVacancies.assertCandidateInVacancy.mockRejectedValue(
        new NotFoundException('Candidate is not in this vacancy'),
      );
      await expect(
        service.getCurrentEvidence(CALLER, ORG_A, 'c1', 'vac-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('404s when the candidate resolves to no live account', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);
      await expect(
        service.getCurrentEvidence(CALLER, ORG_A, 'c1', 'vac-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    function d(id: string, name: string) {
      return {
        id,
        originalFileName: name,
        mimeType: 'application/pdf',
        type: 'RESUME',
        status: 'COMPLETED',
        pageCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    function l(id: string) {
      return {
        id,
        url: `https://example.test/${id}`,
        title: id,
        detectedType: 'PORTFOLIO',
        status: 'COMPLETED',
        lastFetchedAt: new Date(),
        updatedAt: new Date(),
      };
    }
  });

  describe('getCurrentDocumentDownload — signed access to a CURRENT document', () => {
    const CALLER = 'user-hr';

    beforeEach(() => {
      prisma.candidate.findFirst.mockResolvedValue({
        candidateAccount: { id: 'acct-1', userId: 'user-cand' },
      });
    });

    it('signs only a document that belongs to the applicant RIGHT NOW', async () => {
      prisma.document.findFirst.mockResolvedValue({
        storageKey: 'candidate/acct-1/documents/d1.pdf',
        originalFileName: 'Resume.pdf',
        mimeType: 'application/pdf',
      });

      const result = await service.getCurrentDocumentDownload(
        CALLER,
        ORG_A,
        'c1',
        'vac-1',
        'd1',
      );

      expect(prisma.document.findFirst.mock.calls[0][0].where).toEqual({
        id: 'd1',
        candidateAccountId: 'acct-1',
        organizationId: null,
      });
      expect(result).toEqual({
        url: 'https://signed.example/url',
        originalFileName: 'Resume.pdf',
        mimeType: 'application/pdf',
      });
    });

    it("404s a substituted id — another candidate's document, an org copy, a deleted file", async () => {
      prisma.document.findFirst.mockResolvedValue(null);
      await expect(
        service.getCurrentDocumentDownload(CALLER, ORG_A, 'c1', 'vac-1', 'dX'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });

    it('never signs anything when the vacancy is not owned', async () => {
      ownedVacancies.requireOwned.mockRejectedValue(
        new NotFoundException('Vacancy not found'),
      );
      await expect(
        service.getCurrentDocumentDownload(CALLER, ORG_A, 'c1', 'vac-1', 'd1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });
  });
});
