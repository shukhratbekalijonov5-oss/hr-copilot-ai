import { ProcessingService } from './processing.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { DocumentStatus, ProcessingJobStatus } from '../generated/prisma/enums';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

describe('ProcessingService', () => {
  let prisma: any;
  let gateway: any;
  let service: ProcessingService;

  beforeEach(() => {
    prisma = {
      processingJob: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({
          id: 'pj1',
          documentId: 'd1',
          organizationId: ORG_A,
          progress: 40,
        }),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      document: {
        update: jest
          .fn()
          .mockResolvedValue({ id: 'd1', organizationId: ORG_A }),
      },
      vacancy: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'v1',
          title: 't',
          status: 'OPEN',
          createdById: 'hr-a',
        }),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    gateway = {
      emitProgress: jest.fn(),
      emitCompleted: jest.fn(),
      emitFailed: jest.fn(),
    };
    service = new ProcessingService(
      prisma,
      new TenantService(),
      gateway,
      new OwnedVacancyService(prisma),
    );
  });

  describe('createJob', () => {
    it('opens a PENDING job at zero progress', async () => {
      prisma.processingJob.create.mockResolvedValue({ id: 'pj1' });

      await service.createJob(ORG_A, 'd1');

      expect(prisma.processingJob.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          organizationId: ORG_A,
          documentId: 'd1',
          status: ProcessingJobStatus.PENDING,
          progress: 0,
        }),
      );
    });
  });

  describe('lifecycle transitions', () => {
    it('moves the document to QUEUED and emits progress', async () => {
      prisma.processingJob.update.mockResolvedValue({
        id: 'pj1',
        documentId: 'd1',
        organizationId: ORG_A,
      });

      await service.markQueued('pj1', 'bull-1');

      expect(prisma.document.update.mock.calls[0][0].data.status).toBe(
        DocumentStatus.QUEUED,
      );
      expect(gateway.emitProgress).toHaveBeenCalledWith(
        ORG_A,
        expect.objectContaining({ documentStatus: DocumentStatus.QUEUED }),
      );
    });

    it.each([
      [DocumentStatus.PARSING, 10],
      [DocumentStatus.CHUNKING, 40],
      [DocumentStatus.EMBEDDING, 60],
      [DocumentStatus.INDEXING, 85],
    ])('advances to %s at %i%%', async (status, progress) => {
      await service.advance('d1', status, progress);

      expect(prisma.document.update.mock.calls[0][0].data.status).toBe(status);
      expect(gateway.emitProgress).toHaveBeenCalledWith(
        ORG_A,
        expect.objectContaining({ documentStatus: status, progress }),
      );
    });

    it('marks completion only when asked explicitly, at 100%', async () => {
      prisma.document.update.mockResolvedValue({
        id: 'd1',
        organizationId: ORG_A,
      });

      await service.markCompleted('d1', 3);

      expect(prisma.document.update.mock.calls[0][0].data).toEqual({
        status: DocumentStatus.COMPLETED,
        pageCount: 3,
      });
      expect(gateway.emitCompleted).toHaveBeenCalled();
    });

    it('records the failure reason and emits a failure event', async () => {
      await service.markFailed('d1', 'AI service is not configured');

      expect(prisma.document.update.mock.calls[0][0].data.status).toBe(
        DocumentStatus.FAILED,
      );
      expect(gateway.emitFailed).toHaveBeenCalledWith(
        ORG_A,
        expect.objectContaining({
          errorMessage: 'AI service is not configured',
        }),
      );
    });

    it('truncates a very long error message', async () => {
      await service.markFailed('d1', 'x'.repeat(2000));

      const jobUpdate = prisma.processingJob.update.mock.calls[0][0];
      expect(jobUpdate.data.errorMessage).toHaveLength(500);
    });
  });

  describe('read APIs — tenant isolation', () => {
    it('scopes the job list to the caller organization', async () => {
      prisma.processingJob.findMany.mockResolvedValue([]);
      prisma.processingJob.count.mockResolvedValue(0);

      await service.findAll(ORG_A, 'hr-a', 1, 20);

      expect(
        prisma.processingJob.findMany.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });

    it('the vacancy filter restricts to candidates ASSOCIATED with that owned vacancy', async () => {
      prisma.processingJob.findMany.mockResolvedValue([]);
      prisma.processingJob.count.mockResolvedValue(0);

      await service.findAll(ORG_A, 'hr-a', 1, 20, undefined, 'v1');

      const where = prisma.processingJob.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      // One job per document, always: the filter selects, it never duplicates.
      expect(where.document).toEqual({
        candidate: { applications: { some: { vacancyId: 'v1' } } },
      });
    });

    it("a same-org colleague's vacancy filter is refused", async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        title: 't',
        status: 'OPEN',
        createdById: 'hr-a',
      });

      await expect(
        service.findAll(ORG_A, 'hr-b', 1, 20, undefined, 'v1'),
      ).rejects.toMatchObject({ status: 403 });
      expect(prisma.processingJob.findMany).not.toHaveBeenCalled();
    });

    it("404s on another organization's job", async () => {
      prisma.processingJob.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_B, 'pj1')).rejects.toThrow(
        'Processing job not found',
      );
    });
  });
});
