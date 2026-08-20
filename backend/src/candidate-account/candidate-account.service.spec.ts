import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CandidateAccountService } from './candidate-account.service';
import {
  ApplicationSource,
  ApplicationStatus,
} from '../generated/prisma/enums';

const ME = 'user-me';
const MY_ACCOUNT = 'acct-me';

function createPrismaMock() {
  const prisma: any = {
    candidateAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    document: {
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      delete: jest.fn(),
    },
    application: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    vacancy: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ preferredLocale: 'en' }),
    },
    savedJob: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    // The row lock the upload path takes before counting.
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  // Interactive transactions run against the SAME mock so per-test
  // configuration (e.g. document.count results) applies inside them too.
  prisma.$transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg)
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

function createStorageMock() {
  return {
    upload: jest.fn().mockResolvedValue({ storageKey: 'k', size: 1 }),
    delete: jest.fn().mockResolvedValue(undefined),
    getObject: jest.fn(),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/url'),
    exists: jest.fn(),
  };
}

function createProducerMock() {
  return {
    enqueuePersonalResume: jest.fn().mockResolvedValue('job-1'),
    enqueuePersonalResumeIndexDeletion: jest.fn().mockResolvedValue('job-2'),
  };
}

function createAiMock() {
  return {
    candidateJobMatches: jest.fn(),
    deletePersonalResume: jest.fn().mockResolvedValue(undefined),
  };
}

function createAccountTypesMock() {
  return {
    getForUser: jest.fn().mockResolvedValue('CANDIDATE'),
    assertCanOwnCandidateAccount: jest.fn().mockResolvedValue(undefined),
    assertCanHoldMembership: jest.fn(),
  };
}

const configService = {
  get: jest.fn((_: string, fallback?: unknown) => fallback),
} as unknown as ConfigService;

describe('CandidateAccountService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let storage: ReturnType<typeof createStorageMock>;
  let producer: ReturnType<typeof createProducerMock>;
  let ai: ReturnType<typeof createAiMock>;
  let accountTypes: ReturnType<typeof createAccountTypesMock>;
  let service: CandidateAccountService;

  beforeEach(() => {
    prisma = createPrismaMock();
    storage = createStorageMock();
    producer = createProducerMock();
    ai = createAiMock();
    accountTypes = createAccountTypesMock();
    service = new CandidateAccountService(
      prisma as never,
      storage,
      producer as never,
      ai as never,
      accountTypes as never,
      configService,
    );
  });

  describe('self-service scoping (candidate isolation)', () => {
    it('always resolves the account by the AUTHENTICATED user id', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: MY_ACCOUNT });

      await service.getMine(ME);

      expect(prisma.candidateAccount.findUnique.mock.calls[0][0].where).toEqual(
        { userId: ME },
      );
    });

    it('404s when the caller has no account — no way to address anyone else', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue(null);

      await expect(service.getMine(ME)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses a second account for the same user', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: MY_ACCOUNT });

      await expect(service.create(ME, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('enforces the identity invariant on creation (CANDIDATE accounts only)', async () => {
      accountTypes.assertCanOwnCandidateAccount.mockRejectedValue(
        new ForbiddenException(
          'An organization account cannot own a candidate profile',
        ),
      );

      await expect(service.create(ME, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.candidateAccount.create).not.toHaveBeenCalled();
    });
  });

  describe('my applications', () => {
    beforeEach(() => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: MY_ACCOUNT });
    });

    it('lists only DIRECT applications linked to MY candidate account', async () => {
      await service.listMyApplications(ME, { page: 1, limit: 20, skip: 0 });

      expect(prisma.application.findMany.mock.calls[0][0].where).toEqual({
        source: ApplicationSource.DIRECT,
        candidate: { candidateAccountId: MY_ACCOUNT },
      });
    });

    it('exposes no recruiter-side data in the selection', async () => {
      await service.listMyApplications(ME, { page: 1, limit: 20, skip: 0 });

      const select = prisma.application.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('candidate');
      expect(JSON.stringify(select)).not.toContain('evidence');
      expect(select.vacancy.select.organization).toEqual({
        select: { name: true },
      });
    });

    it('404s a foreign application id even when it exists (guessed id)', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.getMyApplication(ME, 'someone-elses-application'),
      ).rejects.toBeInstanceOf(NotFoundException);
      // The lookup was constrained to my account, so "exists but not mine"
      // and "does not exist" are indistinguishable by design.
      expect(prisma.application.findFirst.mock.calls[0][0].where).toMatchObject(
        { candidate: { candidateAccountId: MY_ACCOUNT } },
      );
    });
  });

  describe('withdraw', () => {
    beforeEach(() => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: MY_ACCOUNT });
      prisma.application.update.mockResolvedValue({ id: 'app-1' });
    });

    const mine = (status: ApplicationStatus) =>
      prisma.application.findFirst.mockResolvedValue({ id: 'app-1', status });

    it.each([
      ApplicationStatus.NEW,
      ApplicationStatus.REVIEWING,
      ApplicationStatus.INTERVIEW,
      ApplicationStatus.OFFER,
    ])('withdraws an active application (%s)', async (status) => {
      mine(status);

      await service.withdraw(ME, 'app-1');

      expect(prisma.application.update.mock.calls[0][0].data).toEqual({
        status: ApplicationStatus.WITHDRAWN,
      });
    });

    it.each([
      ApplicationStatus.HIRED,
      ApplicationStatus.REJECTED,
      ApplicationStatus.WITHDRAWN,
    ])('refuses to withdraw from terminal status %s', async (status) => {
      mine(status);

      await expect(service.withdraw(ME, 'app-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.application.update).not.toHaveBeenCalled();
    });

    it('cannot withdraw an application that is not mine', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(service.withdraw(ME, 'foreign-app')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('requireAccount', () => {
    it('explains how to proceed when no candidate account exists', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue(null);

      await expect(service.requireAccount(ME)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('jobMatches — candidate identity only', () => {
    const account = {
      id: MY_ACCOUNT,
      resumeDocumentId: 'doc-1',
      headline: 'Backend Engineer',
      summary: null,
      location: 'Tashkent',
      phone: null,
      skills: ['Docker', 'PostgreSQL'],
      languages: ['English'],
      experience: [{ title: 'Backend Engineer', company: 'Acme' }],
      education: [],
    };
    const aiResult = {
      matches: [
        {
          vacancyId: 'vac-open',
          organizationId: 'org-1',
          title: 'Platform Engineer',
          match: 'STRONG',
          explanation: 'x',
          supportedRequirements: [
            { text: 'Docker', required: true, reason: '' },
          ],
          unsupportedRequirements: [],
          unclearRequirements: [],
          evidence: [
            {
              fileName: 'resume.pdf',
              pageNumber: 1,
              section: 'skills',
              text: 'Docker',
            },
          ],
        },
        {
          vacancyId: 'vac-closed-since',
          organizationId: 'org-2',
          title: 'Old Role',
          match: 'PARTIAL',
          explanation: null,
          supportedRequirements: [],
          unsupportedRequirements: [],
          unclearRequirements: [],
          evidence: [],
        },
      ],
      locale: 'uz',
      vacanciesConsidered: 7,
      generated: true,
      durationMs: 1200,
    };

    beforeEach(() => {
      prisma.candidateAccount.findUnique.mockResolvedValue(account);
      prisma.user.findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ preferredLocale: 'uz' });
      prisma.vacancy.findMany = jest.fn().mockResolvedValue([
        {
          id: 'vac-open',
          publicSlug: 'platform-engineer-org1-abc123',
          title: 'Platform Engineer',
          location: 'Remote',
          employmentType: 'Full-time',
          status: 'OPEN',
          organization: { name: 'Org One' },
        },
      ]);
      prisma.savedJob.findMany.mockResolvedValue([{ vacancyId: 'vac-open' }]);
      prisma.application.findMany.mockResolvedValue([
        { vacancyId: 'vac-open', status: 'NEW' },
      ]);
      ai.candidateJobMatches.mockResolvedValue(aiResult);
    });

    it('matches purely by the OWN candidate account — no organization anywhere', async () => {
      await service.jobMatches(ME, {});

      const call = ai.candidateJobMatches.mock.calls[0][0];
      expect(call.candidateAccountId).toBe(MY_ACCOUNT);
      expect(JSON.stringify(call)).not.toContain('organizationId');
      expect(call.profile.skills).toEqual(['Docker', 'PostgreSQL']);
      // Locale defaults to the user's preferredLocale.
      expect(call.locale).toBe('uz');
    });

    it('re-verifies vacancies against the DB and exposes public slugs, not UUIDs', async () => {
      const result = await service.jobMatches(ME, {});

      expect(result.matches).toHaveLength(1); // the closed one is dropped
      const [match] = result.matches;
      expect(match.vacancy.slug).toBe('platform-engineer-org1-abc123');
      expect(match.vacancy.organizationName).toBe('Org One');
      expect(JSON.stringify(match.vacancy)).not.toContain('vac-open');
      expect(match.saved).toBe(true);
      expect(match.applicationState).toBe('NEW');
      // The DB filter only ever asks for OPEN vacancies.
      expect(prisma.vacancy.findMany.mock.calls[0][0].where.status).toBe(
        'OPEN',
      );
    });

    it('matching NEVER creates applications, candidates or documents', async () => {
      await service.jobMatches(ME, {});

      expect(prisma.application.create).toBeUndefined();
      expect(prisma.document.create).not.toHaveBeenCalled();
      expect(JSON.stringify(prisma.savedJob.create.mock.calls)).toBe('[]');
    });

    it('requires SOME candidate signal (profile or resume)', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({
        ...account,
        resumeDocumentId: null,
        headline: null,
        summary: null,
        skills: [],
        experience: [],
      });

      await expect(service.jobMatches(ME, {})).rejects.toMatchObject({
        status: 422,
      });
      expect(ai.candidateJobMatches).not.toHaveBeenCalled();
    });

    it('an explicit locale wins over the preferred one', async () => {
      await service.jobMatches(ME, { locale: 'ko' });
      expect(ai.candidateJobMatches.mock.calls[0][0].locale).toBe('ko');
    });
  });

  describe('uploadResume — candidate AI indexing lifecycle', () => {
    const pdf = {
      originalname: 'resume.pdf',
      mimetype: 'application/pdf',
      size: 9,
      buffer: Buffer.from('%PDF-1.4 x'),
    };

    beforeEach(() => {
      prisma.candidateAccount.findUnique.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: null,
      });
    });

    it('queues candidate-scoped indexing for a fresh upload', async () => {
      const result = await service.uploadResume(ME, pdf);

      expect(producer.enqueuePersonalResume).toHaveBeenCalledWith({
        documentId: result.id,
        candidateAccountId: MY_ACCOUNT,
      });
      expect(
        producer.enqueuePersonalResumeIndexDeletion,
      ).not.toHaveBeenCalled();
    });

    it('replacement queues indexing of the new and eviction of the old', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: 'old-doc',
      });
      prisma.document.findUnique.mockResolvedValue({
        id: 'old-doc',
        storageKey: 'candidate/acct-me/documents/old-doc.pdf',
      });

      await service.uploadResume(ME, pdf);

      expect(producer.enqueuePersonalResume).toHaveBeenCalled();
      expect(producer.enqueuePersonalResumeIndexDeletion).toHaveBeenCalledWith({
        documentId: 'old-doc',
        candidateAccountId: MY_ACCOUNT,
      });
    });

    it('a queue outage does not fail the upload', async () => {
      producer.enqueuePersonalResume.mockRejectedValue(new Error('redis down'));

      await expect(
        service.uploadResume(ME, pdf as never),
      ).resolves.toMatchObject({ originalFileName: 'resume.pdf' });
    });
  });

  describe('personal document collection — the 3-file invariant', () => {
    const pdf = {
      originalname: 'portfolio.pdf',
      mimetype: 'application/pdf',
      size: 9,
      buffer: Buffer.from('%PDF-1.4 x'),
    };

    beforeEach(() => {
      prisma.candidateAccount.findUnique.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: null,
      });
    });

    it('accepts uploads while under the limit', async () => {
      prisma.document.count.mockResolvedValue(2);

      const result = await service.uploadPersonalDocument(ME, pdf);

      expect(result.originalFileName).toBe('portfolio.pdf');
      expect(prisma.document.create).toHaveBeenCalled();
      expect(producer.enqueuePersonalResume).toHaveBeenCalled();
    });

    it('rejects the 4th file with 409 PERSONAL_DOCUMENT_LIMIT_REACHED and removes the staged bytes', async () => {
      prisma.document.count.mockResolvedValue(3);

      try {
        await service.uploadPersonalDocument(ME, pdf);
        fail('expected the limit to reject the upload');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: 'PERSONAL_DOCUMENT_LIMIT_REACHED',
        });
      }
      // The pre-staged object is cleaned up and no row/job survives.
      expect(prisma.document.create).not.toHaveBeenCalled();
      expect(storage.delete).toHaveBeenCalled();
      expect(producer.enqueuePersonalResume).not.toHaveBeenCalled();
    });

    it('counts FAILED documents toward the limit (a slot is freed by deleting)', async () => {
      // The count is over ALL personal documents, with no status filter.
      prisma.document.count.mockResolvedValue(3);

      await expect(service.uploadPersonalDocument(ME, pdf)).rejects.toThrow();
      const where = prisma.document.count.mock.calls[0][0].where;
      expect(where).toEqual({ candidateAccountId: MY_ACCOUNT });
    });

    it('serializes concurrent uploads with a row lock before counting', async () => {
      prisma.document.count.mockResolvedValue(0);

      await service.uploadPersonalDocument(ME, pdf);

      // The FOR UPDATE lock is what makes count-then-insert atomic; without
      // it two racing uploads could both observe 2 and finish with 4 files.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      const lockOrder = prisma.$queryRaw.mock.invocationCallOrder[0];
      const countOrder = prisma.document.count.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(countOrder);
    });

    it('the legacy replace flow does not count the document it replaces', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: 'old-doc',
      });
      prisma.document.findUnique.mockResolvedValue({
        id: 'old-doc',
        storageKey: 'candidate/acct-me/documents/old-doc.pdf',
      });
      prisma.document.count.mockResolvedValue(2); // the OTHER two files

      await expect(service.uploadResume(ME, pdf)).resolves.toMatchObject({
        originalFileName: 'portfolio.pdf',
      });
      expect(prisma.document.count.mock.calls[0][0].where).toEqual({
        candidateAccountId: MY_ACCOUNT,
        id: { not: 'old-doc' },
      });
    });
  });

  describe('deletePersonalDocument — permanent, owner-only', () => {
    const OWNED = {
      id: 'doc-b',
      storageKey: 'candidate/acct-me/documents/doc-b.pdf',
    };

    beforeEach(() => {
      prisma.candidateAccount.findUnique.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: null,
      });
      prisma.document.findFirst.mockResolvedValue(OWNED);
    });

    it('scopes the lookup to MY personal documents only', async () => {
      await service.deletePersonalDocument(ME, 'doc-b');

      expect(prisma.document.findFirst.mock.calls[0][0].where).toEqual({
        id: 'doc-b',
        candidateAccountId: MY_ACCOUNT,
        organizationId: null,
      });
    });

    it('removes bytes, row and queues vector eviction', async () => {
      const result = await service.deletePersonalDocument(ME, 'doc-b');

      expect(storage.delete).toHaveBeenCalledWith(OWNED.storageKey);
      expect(prisma.document.delete).toHaveBeenCalledWith({
        where: { id: 'doc-b' },
      });
      expect(producer.enqueuePersonalResumeIndexDeletion).toHaveBeenCalledWith({
        documentId: 'doc-b',
        candidateAccountId: MY_ACCOUNT,
      });
      expect(result).toEqual({ id: 'doc-b', deleted: true });
    });

    it('404s a foreign or org-side document — indistinguishable from missing', async () => {
      prisma.document.findFirst.mockResolvedValue(null);

      await expect(
        service.deletePersonalDocument(ME, 'someone-elses-doc'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.document.delete).not.toHaveBeenCalled();
    });

    it('aborts with nothing changed when the storage delete fails', async () => {
      storage.delete.mockRejectedValue(new Error('r2 unreachable'));

      await expect(service.deletePersonalDocument(ME, 'doc-b')).rejects.toThrow(
        'r2 unreachable',
      );
      // Success is never reported while the bytes provably remain.
      expect(prisma.document.delete).not.toHaveBeenCalled();
      expect(
        producer.enqueuePersonalResumeIndexDeletion,
      ).not.toHaveBeenCalled();
    });

    it('repoints the primary resume to the newest survivor', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: 'doc-b', // deleting the current primary
      });
      prisma.document.findFirst
        .mockResolvedValueOnce(OWNED) // ownership lookup
        .mockResolvedValueOnce({ id: 'doc-a' }); // newest remaining

      await service.deletePersonalDocument(ME, 'doc-b');

      expect(prisma.candidateAccount.update).toHaveBeenCalledWith({
        where: { id: MY_ACCOUNT },
        data: { resumeDocumentId: 'doc-a' },
      });
    });

    it('falls back to inline vector eviction when the queue is down', async () => {
      producer.enqueuePersonalResumeIndexDeletion.mockRejectedValue(
        new Error('redis down'),
      );

      await expect(
        service.deletePersonalDocument(ME, 'doc-b'),
      ).resolves.toEqual({ id: 'doc-b', deleted: true });
      expect(ai.deletePersonalResume).toHaveBeenCalledWith(MY_ACCOUNT, 'doc-b');
    });
  });

  describe('saved jobs', () => {
    beforeEach(() => {
      prisma.candidateAccount.findUnique.mockResolvedValue({ id: MY_ACCOUNT });
    });

    it('only OPEN vacancies can be saved', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null); // DRAFT/CLOSED/missing

      await expect(
        service.saveJob(ME, 'closed-job-slug'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.vacancy.findFirst.mock.calls[0][0].where).toEqual({
        publicSlug: 'closed-job-slug',
        status: 'OPEN',
      });
    });

    it('is idempotent for an already-saved job', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.savedJob.findUnique.mockResolvedValue({
        createdAt: new Date('2026-03-01'),
      });

      const result = await service.saveJob(ME, 'open-job');

      expect(result.saved).toBe(true);
      expect(prisma.savedJob.create).not.toHaveBeenCalled();
    });

    it('unsave deletes only from MY saved jobs', async () => {
      await service.unsaveJob(ME, 'open-job');

      expect(prisma.savedJob.deleteMany.mock.calls[0][0].where).toEqual({
        candidateAccountId: MY_ACCOUNT,
        vacancy: { publicSlug: 'open-job' },
      });
    });
  });
});
