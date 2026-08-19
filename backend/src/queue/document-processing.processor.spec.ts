import { Job, UnrecoverableError } from 'bullmq';
import { DocumentProcessingProcessor } from './document-processing.processor';
import type { ProcessDocumentJobData } from './queue.constants';

const ORG_A = 'org-a';

function makeJob(
  data: Partial<ProcessDocumentJobData> = {},
): Job<ProcessDocumentJobData> {
  return {
    data: {
      documentId: 'd1',
      organizationId: ORG_A,
      candidateId: 'c1',
      ...data,
    },
    attemptsMade: 0,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job<ProcessDocumentJobData>;
}

const DOCUMENT = {
  id: 'd1',
  organizationId: ORG_A,
  candidateId: 'c1',
  originalFileName: 'jiwoo-han.pdf',
  storageKey: `org/${ORG_A}/documents/d1.pdf`,
  mimeType: 'application/pdf',
  type: 'RESUME',
};

const AI_RESULT = {
  documentId: 'd1',
  pageCount: 2,
  chunksCreated: 9,
  vectorsIndexed: 9,
  sectionsDetected: ['experience', 'skills'],
  embeddingModel: 'paraphrase-multilingual-MiniLM-L12-v2',
  embeddingDimension: 384,
  durationMs: 1100,
  stages: [],
};

describe('DocumentProcessingProcessor', () => {
  let processing: any;
  let ai: any;
  let prisma: any;
  let storage: any;

  const build = () =>
    new DocumentProcessingProcessor(processing, ai, prisma, storage);

  beforeEach(() => {
    processing = {
      advance: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    ai = {
      enabled: true,
      processDocument: jest.fn().mockResolvedValue(AI_RESULT),
    };
    prisma = { document: { findFirst: jest.fn().mockResolvedValue(DOCUMENT) } };
    storage = {
      getObject: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    };
  });

  describe('while the AI service is not configured', () => {
    beforeEach(() => {
      ai = { enabled: false };
    });

    it('fails the job instead of faking a completed parse', async () => {
      await expect(build().process(makeJob())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(processing.markCompleted).not.toHaveBeenCalled();
    });

    it('records an explanatory failure', async () => {
      await expect(build().process(makeJob())).rejects.toThrow();

      expect(processing.markFailed).toHaveBeenCalledWith(
        'd1',
        expect.stringContaining('AI service is not configured'),
        1,
      );
    });

    it('does not read the file when it cannot be processed', async () => {
      await expect(build().process(makeJob())).rejects.toThrow();
      expect(storage.getObject).not.toHaveBeenCalled();
    });
  });

  describe('with the AI service available', () => {
    it('streams the stored file to the AI service', async () => {
      await build().process(makeJob());

      expect(storage.getObject).toHaveBeenCalledWith(DOCUMENT.storageKey);
      const payload = ai.processDocument.mock.calls[0][0];
      expect(payload.content).toBeInstanceOf(Buffer);
      expect(payload.documentId).toBe('d1');
      expect(payload.organizationId).toBe(ORG_A);
      expect(payload.fileName).toBe('jiwoo-han.pdf');
    });

    it('re-reads the document scoped by organization, not trusting the payload', async () => {
      await build().process(makeJob());

      expect(prisma.document.findFirst.mock.calls[0][0].where).toEqual({
        id: 'd1',
        organizationId: ORG_A,
      });
    });

    it('marks the document completed with the real page count', async () => {
      await build().process(makeJob());

      expect(processing.markCompleted).toHaveBeenCalledWith('d1', 2);
    });

    it('does not write intermediate stages itself', async () => {
      // The AI service reports PARSING..INDEXING as they genuinely complete;
      // writing them here around one HTTP call would be inventing progress.
      await build().process(makeJob());

      expect(processing.advance).not.toHaveBeenCalled();
    });

    it('fails when the AI service indexed nothing', async () => {
      ai.processDocument.mockResolvedValue({ ...AI_RESULT, vectorsIndexed: 0 });

      await expect(build().process(makeJob())).rejects.toThrow(
        /indexed no vectors/,
      );
      expect(processing.markCompleted).not.toHaveBeenCalled();
    });

    it('fails the document when the AI service errors', async () => {
      ai.processDocument.mockRejectedValue(new Error('corrupt_document'));

      await expect(build().process(makeJob())).rejects.toThrow(
        'corrupt_document',
      );
      expect(processing.markFailed).toHaveBeenCalledWith(
        'd1',
        'corrupt_document',
        1,
      );
      expect(processing.markCompleted).not.toHaveBeenCalled();
    });

    it('fails unrecoverably when the document no longer exists', async () => {
      prisma.document.findFirst.mockResolvedValue(null);

      await expect(build().process(makeJob())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    });

    it('reports the attempt number on retries', async () => {
      const job = makeJob();
      (job as unknown as { attemptsMade: number }).attemptsMade = 2;
      ai.processDocument.mockRejectedValue(new Error('boom'));

      await expect(build().process(job)).rejects.toThrow();

      expect(processing.markFailed).toHaveBeenCalledWith('d1', 'boom', 3);
    });

    it('fails when the stored file is unreadable', async () => {
      storage.getObject.mockRejectedValue(new Error('Object not found'));

      await expect(build().process(makeJob())).rejects.toThrow(
        'Object not found',
      );
      expect(processing.markFailed).toHaveBeenCalled();
      expect(ai.processDocument).not.toHaveBeenCalled();
    });
  });
});
