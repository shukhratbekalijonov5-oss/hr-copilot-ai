import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { TenantService } from '../common/tenant/tenant.service';

describe('DocumentsService — no upload surface', () => {
  it('has no upload method: HR cannot put a file onto a candidate', () => {
    // Removal is architectural, not cosmetic. Org documents exist only as
    // apply-time snapshots written by PublicJobsService.apply.
    expect(
      (DocumentsService.prototype as unknown as Record<string, unknown>).upload,
    ).toBeUndefined();
  });
});

describe('DocumentsService.reprocess', () => {
  const ORG = 'org-a';
  let prisma: any;
  let storage: any;
  let processing: any;
  let producer: any;
  let ai: any;
  let service: DocumentsService;

  beforeEach(() => {
    prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'd1',
          organizationId: ORG,
          candidateId: 'c1',
          storageKey: 'org/org-a/documents/d1.pdf',
          status: 'FAILED',
        }),
        delete: jest.fn(),
      },
      candidate: { findFirst: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    storage = {
      exists: jest.fn().mockResolvedValue(true),
      upload: jest.fn(),
      delete: jest.fn(),
      getObject: jest.fn(),
      getSignedUrl: jest.fn(),
    };
    processing = {
      createJob: jest.fn().mockResolvedValue({ id: 'pj-2' }),
      markQueued: jest.fn(),
      markFailed: jest.fn(),
    };
    producer = {
      enqueueDocument: jest.fn().mockResolvedValue('document-d1'),
      hasLiveJob: jest.fn().mockResolvedValue(true),
    };
    ai = { enabled: true, deleteDocument: jest.fn() };

    service = new DocumentsService(
      prisma,
      new TenantService(),
      storage,
      processing,
      producer,
      ai,
    );
  });

  it('requeues a failed document without a re-upload', async () => {
    producer.hasLiveJob.mockResolvedValue(false);
    const result = await service.reprocess(ORG, 'd1');

    expect(producer.enqueueDocument).toHaveBeenCalledWith(
      { documentId: 'd1', organizationId: ORG, candidateId: 'c1' },
      // The previous job still holds this document's BullMQ job id.
      { replaceExisting: true },
    );
    expect(processing.markQueued).toHaveBeenCalledWith('pj-2', 'document-d1');
    expect(result.status).toBe('QUEUED');
  });

  it('refuses to reprocess a document from another organization', async () => {
    prisma.document.findFirst.mockResolvedValue(null);

    await expect(service.reprocess('org-b', 'd1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(producer.enqueueDocument).not.toHaveBeenCalled();
  });

  it('refuses to reprocess an already-completed document', async () => {
    prisma.document.findFirst.mockResolvedValue({
      id: 'd1',
      organizationId: ORG,
      candidateId: 'c1',
      storageKey: 'k',
      status: 'COMPLETED',
    });

    await expect(service.reprocess(ORG, 'd1')).rejects.toThrow(
      /already processed/,
    );
    expect(producer.enqueueDocument).not.toHaveBeenCalled();
  });

  it.each(['QUEUED', 'PARSING', 'EMBEDDING', 'INDEXING'])(
    'refuses to double-queue a document already in %s',
    async (status) => {
      prisma.document.findFirst.mockResolvedValue({
        id: 'd1',
        organizationId: ORG,
        candidateId: 'c1',
        storageKey: 'k',
        status,
      });

      await expect(service.reprocess(ORG, 'd1')).rejects.toThrow(
        /already being processed/,
      );
      expect(producer.enqueueDocument).not.toHaveBeenCalled();
    },
  );

  it('refuses when the stored file is gone', async () => {
    // Queueing would only fail again on a missing object.
    storage.exists.mockResolvedValue(false);

    await expect(service.reprocess(ORG, 'd1')).rejects.toThrow(
      /must be re-uploaded/,
    );
    expect(producer.enqueueDocument).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.remove', () => {
  const ORG = 'org-a';
  let prisma: any;
  let storage: any;
  let ai: any;
  let service: DocumentsService;

  beforeEach(() => {
    prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: 'd1', storageKey: 'k' }),
        delete: jest.fn(),
      },
      candidate: { findFirst: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    storage = {
      delete: jest.fn(),
      exists: jest.fn(),
      upload: jest.fn(),
      getObject: jest.fn(),
      getSignedUrl: jest.fn(),
    };
    ai = {
      enabled: true,
      deleteDocument: jest.fn().mockResolvedValue(undefined),
    };

    service = new DocumentsService(
      prisma,
      new TenantService(),
      storage,
      {
        createJob: jest.fn(),
        markQueued: jest.fn(),
        markFailed: jest.fn(),
      } as any,
      { enqueueDocument: jest.fn() } as any,
      ai,
    );
  });

  it('removes the vectors so a deleted resume stops being searchable', async () => {
    await service.remove(ORG, 'd1');

    expect(ai.deleteDocument).toHaveBeenCalledWith(ORG, 'd1');
  });

  it('still reports success when vector cleanup fails', async () => {
    ai.deleteDocument.mockRejectedValue(new Error('qdrant down'));

    await expect(service.remove(ORG, 'd1')).resolves.toEqual({
      id: 'd1',
      deleted: true,
    });
  });
});
