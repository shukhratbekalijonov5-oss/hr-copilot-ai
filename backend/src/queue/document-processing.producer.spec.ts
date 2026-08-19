import { DocumentProcessingProducer } from './document-processing.producer';
import { PROCESS_DOCUMENT_JOB } from './queue.constants';
import type { Queue } from 'bullmq';

describe('DocumentProcessingProducer', () => {
  let queue: { add: jest.Mock; waitUntilReady: jest.Mock };
  let producer: DocumentProcessingProducer;

  beforeEach(() => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'document-d1' }),
      waitUntilReady: jest.fn().mockResolvedValue(undefined),
    };
    producer = new DocumentProcessingProducer(queue as unknown as Queue);
  });

  const data = { documentId: 'd1', organizationId: 'org-a', candidateId: 'c1' };

  it('enqueues the PROCESS_DOCUMENT job on the resume-processing queue', async () => {
    await producer.enqueueDocument(data);

    expect(queue.add).toHaveBeenCalledWith(
      PROCESS_DOCUMENT_JOB,
      data,
      expect.any(Object),
    );
  });

  it('returns the BullMQ job id so it can be stored on the ProcessingJob row', async () => {
    await expect(producer.enqueueDocument(data)).resolves.toBe('document-d1');
  });

  /**
   * Regression: BullMQ rejects a custom job id containing ':' — that character
   * is its own Redis key delimiter — and the upload then failed to enqueue.
   */
  it('builds a job id BullMQ will accept', async () => {
    await producer.enqueueDocument(data);

    const jobId = queue.add.mock.calls[0][2].jobId;
    expect(jobId).not.toContain(':');
    expect(jobId).toBe('document-d1');
  });

  it('passes identifiers only — no file contents', async () => {
    await producer.enqueueDocument(data);

    expect(queue.add.mock.calls[0][1]).toEqual({
      documentId: 'd1',
      organizationId: 'org-a',
      candidateId: 'c1',
    });
  });

  it('tolerates a document with no candidate attached', async () => {
    await producer.enqueueDocument({ ...data, candidateId: null });

    expect(queue.add.mock.calls[0][1].candidateId).toBeNull();
  });

  it('returns null when BullMQ assigns no id', async () => {
    queue.add.mockResolvedValue({});

    await expect(producer.enqueueDocument(data)).resolves.toBeNull();
  });
});

describe('DocumentProcessingProducer.enqueueDocument — requeue', () => {
  let queue: any;
  let producer: DocumentProcessingProducer;
  const data = { documentId: 'd1', organizationId: 'org-a', candidateId: 'c1' };

  beforeEach(() => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'document-d1' }),
      getJob: jest.fn().mockResolvedValue(null),
      waitUntilReady: jest.fn().mockResolvedValue(undefined),
    };
    producer = new DocumentProcessingProducer(queue);
  });

  it('does not look for an existing job on a normal upload', async () => {
    await producer.enqueueDocument(data);
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  /**
   * Regression: BullMQ treats `add` with an existing jobId as a no-op and
   * returns the old job. A retry after a failure therefore enqueued nothing
   * and the document sat in QUEUED forever.
   */
  it('removes a finished job before requeuing', async () => {
    const existing = {
      id: 'document-d1',
      getState: jest.fn().mockResolvedValue('failed'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    queue.getJob.mockResolvedValue(existing);

    await producer.enqueueDocument(data, { replaceExisting: true });

    expect(existing.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });

  it('requeues cleanly when no previous job remains', async () => {
    await producer.enqueueDocument(data, { replaceExisting: true });
    expect(queue.add).toHaveBeenCalled();
  });

  it.each(['active', 'waiting', 'delayed'])(
    'refuses to displace a job that is still %s',
    async (state) => {
      const existing = {
        id: 'document-d1',
        getState: jest.fn().mockResolvedValue(state),
        remove: jest.fn(),
      };
      queue.getJob.mockResolvedValue(existing);

      const result = await producer.enqueueDocument(data, {
        replaceExisting: true,
      });

      expect(existing.remove).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(result).toBe('document-d1');
    },
  );

  it('removes a completed job so a document can be re-indexed', async () => {
    const existing = {
      id: 'document-d1',
      getState: jest.fn().mockResolvedValue('completed'),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    queue.getJob.mockResolvedValue(existing);

    await producer.enqueueDocument(data, { replaceExisting: true });

    expect(existing.remove).toHaveBeenCalled();
  });
});

describe('DocumentProcessingProducer.hasLiveJob', () => {
  let queue: any;
  let producer: DocumentProcessingProducer;

  beforeEach(() => {
    queue = { getJob: jest.fn(), add: jest.fn(), waitUntilReady: jest.fn() };
    producer = new DocumentProcessingProducer(queue);
  });

  it('is false when no job exists', async () => {
    queue.getJob.mockResolvedValue(null);
    await expect(producer.hasLiveJob('d1')).resolves.toBe(false);
  });

  it.each(['active', 'waiting', 'delayed'])(
    'is true for a %s job',
    async (state) => {
      queue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue(state),
      });
      await expect(producer.hasLiveJob('d1')).resolves.toBe(true);
    },
  );

  it.each(['failed', 'completed'])('is false for a %s job', async (state) => {
    queue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue(state),
    });
    await expect(producer.hasLiveJob('d1')).resolves.toBe(false);
  });
});
