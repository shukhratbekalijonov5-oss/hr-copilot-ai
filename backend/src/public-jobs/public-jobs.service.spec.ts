import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PublicJobsService } from './public-jobs.service';
import {
  ApplicationSource,
  ApplicationStatus,
  VacancyStatus,
} from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { ProcessingService } from '../processing/processing.service';
import type { DocumentProcessingProducer } from '../queue/document-processing.producer';
import type { CandidateAccountService } from '../candidate-account/candidate-account.service';

const ORG_A = 'org-a';
const SLUG = 'senior-backend-engineer-northwind-abc123';
const ME = 'user-me';
const MY_ACCOUNT = 'acct-me';

function createPrismaMock() {
  const tx = {
    candidate: { upsert: jest.fn() },
    document: { create: jest.fn() },
    application: { create: jest.fn() },
  };
  return {
    tx,
    vacancy: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    candidate: { findUnique: jest.fn() },
    application: { findUnique: jest.fn() },
    document: { findUnique: jest.fn() },
    user: { findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg)
        : (arg as (t: typeof tx) => unknown)(tx),
    ),
  };
}

describe('PublicJobsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let storage: {
    getObject: jest.Mock;
    upload: jest.Mock;
    delete: jest.Mock;
  };
  let processing: {
    createJob: jest.Mock;
    markQueued: jest.Mock;
    markFailed: jest.Mock;
  };
  let producer: { enqueueDocument: jest.Mock };
  let accounts: { requireAccount: jest.Mock };
  let service: PublicJobsService;
  let events: { publish: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    storage = {
      getObject: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
      upload: jest.fn().mockResolvedValue({ storageKey: 'k', size: 9 }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    processing = {
      createJob: jest.fn().mockResolvedValue({ id: 'pj-1' }),
      markQueued: jest.fn(),
      markFailed: jest.fn(),
    };
    producer = { enqueueDocument: jest.fn().mockResolvedValue('bull-1') };
    accounts = {
      requireAccount: jest.fn().mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: 'personal-doc-1',
        phone: '+998900000000',
        location: 'Tashkent',
        headline: 'Backend Engineer',
      }),
    };
    events = { publish: jest.fn() };
    service = new PublicJobsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      processing as unknown as ProcessingService,
      producer as unknown as DocumentProcessingProducer,
      accounts as unknown as CandidateAccountService,
      events as never,
    );

    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'Jasur Toshmatov',
      email: 'jasur@example.test',
    });
    prisma.document.findUnique.mockResolvedValue({
      storageKey: 'candidate/acct-me/documents/personal-doc-1.pdf',
      originalFileName: 'resume.pdf',
      mimeType: 'application/pdf',
    });
    prisma.tx.candidate.upsert.mockResolvedValue({ id: 'cand-1' });
    prisma.tx.application.create.mockResolvedValue({
      id: 'app-1',
      status: ApplicationStatus.NEW,
      source: ApplicationSource.DIRECT,
    });
  });

  describe('public listing safety', () => {
    it('lists ONLY open vacancies', async () => {
      await service.list({ page: 1, limit: 20, skip: 0 });

      expect(prisma.vacancy.findMany.mock.calls[0][0].where.status).toBe(
        VacancyStatus.OPEN,
      );
    });

    it('selects only advertisement-safe fields', async () => {
      await service.list({ page: 1, limit: 20, skip: 0 });

      const select = prisma.vacancy.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('id');
      expect(select).not.toHaveProperty('createdBy');
      expect(select).not.toHaveProperty('createdById');
      expect(select).not.toHaveProperty('_count');
      expect(select).not.toHaveProperty('applications');
      expect(select.organization).toEqual({ select: { name: true } });
    });

    it('404s a DRAFT/CLOSED/ARCHIVED slug exactly like a missing one', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.detail('draft-job-slug')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.vacancy.findFirst.mock.calls[0][0].where).toEqual({
        publicSlug: 'draft-job-slug',
        status: VacancyStatus.OPEN,
      });
    });
  });

  describe('apply — the direct application flow', () => {
    beforeEach(() => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'vac-1',
        organizationId: ORG_A,
      });
      prisma.candidate.findUnique.mockResolvedValue(null);
    });

    it('creates candidate + application(source=DIRECT) + resume snapshot in the vacancy organization', async () => {
      const result = await service.apply(ME, SLUG);

      // Org-side candidate linked to my account, one per org per account.
      const upsert = prisma.tx.candidate.upsert.mock.calls[0][0];
      expect(upsert.where.organizationId_candidateAccountId).toEqual({
        organizationId: ORG_A,
        candidateAccountId: MY_ACCOUNT,
      });
      // Reuse must not overwrite recruiter-enriched data.
      expect(upsert.update).toEqual({});

      // The snapshot document is ORG-owned, never the personal document.
      const doc = prisma.tx.document.create.mock.calls[0][0].data;
      expect(doc.organizationId).toBe(ORG_A);
      expect(doc.candidateId).toBe('cand-1');
      expect(storage.upload.mock.calls[0][0].key).toMatch(`org/${ORG_A}/`);

      const app = prisma.tx.application.create.mock.calls[0][0].data;
      expect(app.source).toBe(ApplicationSource.DIRECT);
      expect(app.status).toBe(ApplicationStatus.NEW);
      expect(app.submittedDocumentId).toBe(doc.id);

      expect((result as { id: string }).id).toBe('app-1');
    });

    it('queues AI processing under the VACANCY organization (Qdrant tenancy)', async () => {
      await service.apply(ME, SLUG);

      // The org-scoped copy is what gets indexed; org B never received a
      // document, so org B's searches (always org-filtered) cannot see it.
      expect(producer.enqueueDocument.mock.calls[0][0]).toMatchObject({
        organizationId: ORG_A,
        candidateId: 'cand-1',
      });
      expect(processing.createJob).toHaveBeenCalledWith(
        ORG_A,
        expect.any(String),
      );
    });

    it('404s a non-OPEN or unknown job', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.apply(ME, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('requires a candidate account', async () => {
      accounts.requireAccount.mockRejectedValue(
        new BadRequestException('A candidate account is required.'),
      );

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('requires an uploaded resume', async () => {
      accounts.requireAccount.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: null,
      });

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.tx.application.create).not.toHaveBeenCalled();
    });

    it('409s a duplicate application to the same vacancy (defined policy)', async () => {
      prisma.candidate.findUnique.mockResolvedValue({ id: 'cand-1' });
      prisma.application.findUnique.mockResolvedValue({ id: 'existing-app' });

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        ConflictException,
      );
      // Rejected BEFORE any storage copy or row creation.
      expect(storage.upload).not.toHaveBeenCalled();
      expect(prisma.tx.application.create).not.toHaveBeenCalled();
    });

    it('maps a concurrent double-submit (unique violation) to 409 and cleans the copy', async () => {
      prisma.tx.application.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(storage.delete).toHaveBeenCalled();
    });

    it('keeps the application even when queueing fails (marked FAILED, retryable)', async () => {
      producer.enqueueDocument.mockRejectedValue(new Error('redis down'));

      const result = await service.apply(ME, SLUG);

      expect((result as { id: string }).id).toBe('app-1');
      expect(processing.markFailed).toHaveBeenCalled();
    });
  });
});
