import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentsService } from './documents.service';
import { TenantService } from '../common/tenant/tenant.service';
import { DOCUMENT_ERROR_CODES } from './document-policy';
import { DocumentType } from '../generated/prisma/enums';
import type { StorageService } from '../storage/storage.service';

const ORG_A = 'org-a';

function pdfFile() {
  const buffer = Buffer.concat([
    Buffer.from([0x25, 0x50, 0x44, 0x46]),
    Buffer.alloc(32, 0x41),
  ]);
  return {
    originalname: 'resume.pdf',
    mimetype: 'application/pdf',
    size: buffer.byteLength,
    buffer,
  };
}

describe('DocumentsService.upload', () => {
  let prisma: any;
  let storage: jest.Mocked<StorageService>;
  let processing: any;
  let producer: any;
  let ai: any;
  let service: DocumentsService;

  beforeEach(() => {
    prisma = {
      candidate: {
        // A manually added candidate of the caller's organization — the only
        // target the HR upload policy allows.
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'c1', candidateAccountId: null }),
      },
      document: {
        create: jest.fn(({ data }: any) =>
          Promise.resolve({
            ...data,
            status: 'UPLOADED',
            createdAt: new Date(),
          }),
        ),
        delete: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    storage = {
      upload: jest.fn().mockResolvedValue({ storageKey: 'k', size: 36 }),
      delete: jest.fn(),
      getSignedUrl: jest.fn(),
      exists: jest.fn(),
    };
    processing = {
      createJob: jest.fn().mockResolvedValue({ id: 'pj1' }),
      markQueued: jest.fn(),
      markFailed: jest.fn(),
    };
    producer = { enqueueDocument: jest.fn().mockResolvedValue('bull-1') };

    const config = {
      get: jest.fn((_key: string, fallback: unknown) => fallback),
    } as unknown as ConfigService;

    ai = { enabled: true, deleteDocument: jest.fn() };

    service = new DocumentsService(
      prisma,
      new TenantService(),
      storage,
      processing,
      producer,
      ai,
      config,
    );
  });

  it('stores the document under the caller organization', async () => {
    await service.upload(ORG_A, pdfFile(), { candidateId: 'c1' });

    expect(prisma.document.create.mock.calls[0][0].data.organizationId).toBe(
      ORG_A,
    );
  });

  it('namespaces the storage key by organization', async () => {
    await service.upload(ORG_A, pdfFile(), { candidateId: 'c1' });

    const key = storage.upload.mock.calls[0][0].key;
    expect(key).toMatch(new RegExp(`^org/${ORG_A}/documents/`));
    expect(key).toMatch(/\.pdf$/);
  });

  it('rejects an invalid file before creating any row', async () => {
    const bad = { ...pdfFile(), mimetype: 'image/png', originalname: 'x.png' };

    await expect(
      service.upload(ORG_A, bad, { candidateId: 'c1' }),
    ).rejects.toThrow(/Unsupported file type/);
    expect(prisma.document.create).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(producer.enqueueDocument).not.toHaveBeenCalled();
  });

  it('rejects a candidate from another organization', async () => {
    prisma.candidate.findFirst.mockResolvedValue(null);

    await expect(
      service.upload(ORG_A, pdfFile(), { candidateId: 'c-other' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  describe('HR upload policy (manual candidates only)', () => {
    it('always resolves the candidate inside the caller organization', async () => {
      await service.upload(ORG_A, pdfFile(), { candidateId: 'c1' });

      expect(prisma.candidate.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'c1',
        organizationId: ORG_A,
      });
    });

    it('refuses a generic upload with no candidate, even from an internal caller', async () => {
      await expect(
        service.upload(ORG_A, pdfFile(), {} as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.document.create).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('refuses an application-derived candidate with 403 HR_DOCUMENT_UPLOAD_NOT_ALLOWED', async () => {
      // candidateAccountId set = the person applied through the platform and
      // manages their own documents; HR must not graft files onto them.
      prisma.candidate.findFirst.mockResolvedValue({
        id: 'c-linked',
        candidateAccountId: 'acct-1',
      });

      try {
        await service.upload(ORG_A, pdfFile(), { candidateId: 'c-linked' });
        fail('expected the upload to be refused');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toMatchObject({
          code: DOCUMENT_ERROR_CODES.HR_DOCUMENT_UPLOAD_NOT_ALLOWED,
        });
      }
      expect(prisma.document.create).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
      expect(producer.enqueueDocument).not.toHaveBeenCalled();
    });
  });

  describe('queue job creation', () => {
    it('enqueues exactly one job carrying identifiers only', async () => {
      await service.upload(ORG_A, pdfFile(), { candidateId: 'c1' });

      expect(producer.enqueueDocument).toHaveBeenCalledTimes(1);
      const payload = producer.enqueueDocument.mock.calls[0][0];
      expect(Object.keys(payload).sort()).toEqual([
        'candidateId',
        'documentId',
        'organizationId',
      ]);
      expect(payload.organizationId).toBe(ORG_A);
      expect(payload.candidateId).toBe('c1');
    });

    it('never puts file contents or a signed URL in the job payload', async () => {
      await service.upload(ORG_A, pdfFile(), { candidateId: 'c1' });

      const payload = producer.enqueueDocument.mock.calls[0][0];
      const serialised = JSON.stringify(payload);
      expect(serialised).not.toContain('PDF');
      expect(serialised).not.toMatch(/http/);
      expect(payload).not.toHaveProperty('buffer');
    });

    it('creates a ProcessingJob row and marks it queued', async () => {
      await service.upload(ORG_A, pdfFile(), { candidateId: 'c1' });

      expect(processing.createJob).toHaveBeenCalledWith(
        ORG_A,
        expect.any(String),
      );
      expect(processing.markQueued).toHaveBeenCalledWith('pj1', 'bull-1');
    });

    it('returns without doing any AI work on the request thread', async () => {
      const result = await service.upload(ORG_A, pdfFile(), {
        candidateId: 'c1',
      });

      expect(result.status).toBe('UPLOADED');
      expect(result.processingJobId).toBe('pj1');
    });

    it('records a failure rather than losing the upload when Redis is down', async () => {
      producer.enqueueDocument.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.upload(ORG_A, pdfFile(), {
        candidateId: 'c1',
      });

      // The document row and stored bytes survive; the job is marked failed.
      expect(result.id).toEqual(expect.any(String));
      expect(processing.markFailed).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Failed to enqueue processing job'),
      );
      expect(prisma.document.delete).not.toHaveBeenCalled();
    });
  });

  it('rolls the document row back when storage upload fails', async () => {
    storage.upload.mockRejectedValue(new Error('bucket unreachable'));

    await expect(
      service.upload(ORG_A, pdfFile(), { candidateId: 'c1' }),
    ).rejects.toThrow('bucket unreachable');
    expect(prisma.document.delete).toHaveBeenCalled();
    expect(producer.enqueueDocument).not.toHaveBeenCalled();
  });

  it('defaults the document type to RESUME', async () => {
    await service.upload(ORG_A, pdfFile(), { candidateId: 'c1' });

    expect(prisma.document.create.mock.calls[0][0].data.type).toBe(
      DocumentType.RESUME,
    );
  });

  it('never exposes the storage key in the upload response', async () => {
    const result = await service.upload(ORG_A, pdfFile(), {
      candidateId: 'c1',
    });

    expect(result).not.toHaveProperty('storageKey');
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

    const config = {
      get: jest.fn((_k: string, fallback: unknown) => fallback),
    } as unknown as ConfigService;

    service = new DocumentsService(
      prisma,
      new TenantService(),
      storage,
      processing,
      producer,
      ai,
      config,
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
      {
        get: jest.fn((_k: string, f: unknown) => f),
      } as unknown as ConfigService,
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
