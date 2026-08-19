import {
  BadRequestException,
  ConflictException,
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
  return {
    candidateAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    document: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    application: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    vacancy: { findFirst: jest.fn() },
    savedJob: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (tx: unknown) => unknown)(createPrismaMock()),
    ),
  };
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

const configService = {
  get: jest.fn((_: string, fallback?: unknown) => fallback),
} as unknown as ConfigService;

describe('CandidateAccountService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let storage: ReturnType<typeof createStorageMock>;
  let service: CandidateAccountService;

  beforeEach(() => {
    prisma = createPrismaMock();
    storage = createStorageMock();
    service = new CandidateAccountService(
      prisma as never,
      storage,
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
