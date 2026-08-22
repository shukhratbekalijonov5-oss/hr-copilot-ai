import { Job, UnrecoverableError } from 'bullmq';
import { DocumentProcessingProcessor } from './document-processing.processor';
import { WebIngestionError } from '../web-ingestion/web-ingestion.errors';
import { LinkFailureCode } from '../generated/prisma/enums';
import type { ProcessDocumentJobData } from './queue.constants';

const ORG_A = 'org-a';

function makeJob(
  data: Partial<ProcessDocumentJobData> = {},
): Job<ProcessDocumentJobData> {
  return {
    // Named, like every real job: the processor dispatches on the name and
    // refuses one it does not recognise rather than guessing at the payload.
    name: 'PROCESS_DOCUMENT',
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

const LINK = {
  id: 'link-1',
  candidateAccountId: 'acct-1',
  url: 'https://portfolio.example.com/',
  title: null,
};

const LINK_SOURCE = {
  id: 'link-src-1',
  organizationId: ORG_A,
  applicationId: 'app-1',
  url: 'https://portfolio.example.com/',
  title: 'Portfolio Website',
  detectedType: 'WEBSITE',
  sections: [
    {
      name: 'projects',
      heading: 'Projects',
      text: 'Kubernetes deployment work',
      url: 'https://portfolio.example.com/projects',
    },
  ],
};

const INGESTED = {
  finalUrl: 'https://portfolio.example.com/',
  title: 'Ji-woo Han',
  description: null,
  detectedType: 'WEBSITE',
  sections: [
    {
      name: 'projects',
      heading: 'Projects',
      text: 'Kubernetes deployment work',
      url: 'https://portfolio.example.com/projects',
    },
  ],
  charCount: 26,
  pagesFetched: 2,
  fetchMode: 'STATIC' as const,
  contentHash: 'a'.repeat(64),
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
  let web: any;

  const build = () =>
    new DocumentProcessingProcessor(processing, ai, prisma, storage, web);

  beforeEach(() => {
    processing = {
      advance: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    ai = {
      enabled: true,
      deleteDocument: jest.fn().mockResolvedValue(undefined),
      processDocument: jest.fn().mockResolvedValue(AI_RESULT),
      processPersonalResume: jest.fn().mockResolvedValue({
        documentId: 'pd1',
        pageCount: 1,
        chunksCreated: 3,
        vectorsIndexed: 3,
        durationMs: 300,
      }),
      deletePersonalResume: jest.fn().mockResolvedValue(undefined),
      indexVacancy: jest.fn().mockResolvedValue(undefined),
      deleteVacancyIndex: jest.fn().mockResolvedValue(undefined),
      indexPersonalWebSource: jest.fn().mockResolvedValue({
        sourceId: 'link-1',
        chunksCreated: 5,
        vectorsIndexed: 5,
        durationMs: 200,
      }),
      indexApplicationWebSource: jest.fn().mockResolvedValue({
        sourceId: 'link-src-1',
        chunksCreated: 5,
        vectorsIndexed: 5,
        durationMs: 200,
      }),
      deletePersonalWebSource: jest.fn().mockResolvedValue(undefined),
      deleteApplicationWebSource: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue(DOCUMENT),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vacancy: { findUnique: jest.fn() },
      candidateLink: {
        findFirst: jest.fn().mockResolvedValue(LINK),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      applicationLinkSource: {
        findFirst: jest.fn().mockResolvedValue(LINK_SOURCE),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // A link whose content CHANGED invalidates anything generated from the
      // old content, so indexing it bumps the account's evidence revision.
      candidateAccount: { update: jest.fn().mockResolvedValue({}) },
    };
    storage = {
      getObject: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    };
    web = { ingest: jest.fn().mockResolvedValue(INGESTED) };
  });

  describe('personal resume jobs (candidate-scoped path)', () => {
    const personalJob = (over: Record<string, unknown> = {}) =>
      ({
        name: 'PROCESS_PERSONAL_RESUME',
        data: { documentId: 'pd1', candidateAccountId: 'acct-1' },
        attemptsMade: 0,
        ...over,
      }) as never;

    beforeEach(() => {
      prisma.document.findFirst.mockResolvedValue({
        id: 'pd1',
        originalFileName: 'me.pdf',
        storageKey: 'candidate/acct-1/documents/pd1.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('verifies OWNERSHIP and org-lessness before indexing', async () => {
      await build().process(personalJob());

      expect(prisma.document.findFirst.mock.calls[0][0].where).toEqual({
        id: 'pd1',
        candidateAccountId: 'acct-1',
        organizationId: null,
      });
      expect(ai.processPersonalResume).toHaveBeenCalledWith(
        expect.objectContaining({ candidateAccountId: 'acct-1' }),
      );
      // Never the org pipeline, never a ProcessingJob write.
      expect(ai.processDocument).not.toHaveBeenCalled();
      expect(processing.markCompleted).not.toHaveBeenCalled();
      expect(prisma.document.updateMany.mock.calls[0][0].data.status).toBe(
        'COMPLETED',
      );
    });

    it('marks the personal document FAILED when indexing fails', async () => {
      ai.processPersonalResume.mockRejectedValue(new Error('boom'));

      await expect(build().process(personalJob())).rejects.toThrow('boom');
      expect(prisma.document.updateMany.mock.calls[0][0].data.status).toBe(
        'FAILED',
      );
    });

    it('the delete job evicts the replaced resume vectors', async () => {
      await build().process({
        name: 'DELETE_PERSONAL_RESUME_INDEX',
        data: { documentId: 'old', candidateAccountId: 'acct-1' },
        attemptsMade: 0,
      } as never);

      expect(ai.deletePersonalResume).toHaveBeenCalledWith('acct-1', 'old');
    });

    describe('delete-during-processing (tombstone protection)', () => {
      it('a document deleted before the job ran is evicted, never indexed', async () => {
        prisma.document.findFirst.mockResolvedValue(null);

        await expect(build().process(personalJob())).rejects.toBeInstanceOf(
          UnrecoverableError,
        );
        // An earlier attempt may already have indexed vectors — evict them.
        expect(ai.deletePersonalResume).toHaveBeenCalledWith('acct-1', 'pd1');
        expect(ai.processPersonalResume).not.toHaveBeenCalled();
      });

      it('a delete landing WHILE indexing evicts the fresh vectors instead of completing', async () => {
        // The guarded status write reports no matching row: the document was
        // deleted between the ownership read and indexing finishing.
        prisma.document.updateMany.mockResolvedValue({ count: 0 });

        await build().process(personalJob());

        expect(ai.processPersonalResume).toHaveBeenCalled();
        expect(ai.deletePersonalResume).toHaveBeenCalledWith('acct-1', 'pd1');
        // Nothing is resurrected: no COMPLETED write happened (count 0) and
        // the job succeeds so BullMQ will not retry-and-reindex.
      });

      it('a failed eviction keeps the job retryable so it converges', async () => {
        prisma.document.updateMany.mockResolvedValue({ count: 0 });
        ai.deletePersonalResume.mockRejectedValue(new Error('qdrant down'));

        await expect(build().process(personalJob())).rejects.toThrow(
          'qdrant down',
        );
      });
    });
  });

  describe('vacancy index sync jobs', () => {
    const syncJob = () =>
      ({
        name: 'SYNC_VACANCY_INDEX',
        data: { vacancyId: 'v1' },
        attemptsMade: 0,
      }) as never;

    it('an OPEN vacancy is indexed with candidate-visible fields only', async () => {
      prisma.vacancy.findUnique.mockResolvedValue({
        id: 'v1',
        organizationId: ORG_A,
        status: 'OPEN',
        title: 'Backend Engineer',
        description: 'Build things',
        location: 'Remote',
        employmentType: 'Full-time',
        requirements: [{ text: 'Docker', required: true }],
      });

      await build().process(syncJob());

      const sent = ai.indexVacancy.mock.calls[0][0];
      expect(sent.vacancyId).toBe('v1');
      expect(sent.requirements).toEqual([{ text: 'Docker', required: true }]);
      // Recruiter-side data is not even selected, let alone sent.
      expect(JSON.stringify(sent)).not.toContain('createdBy');
      expect(JSON.stringify(sent)).not.toContain('applications');
    });

    it.each(['DRAFT', 'CLOSED', 'ARCHIVED'])(
      'a %s vacancy is removed from the index',
      async (status) => {
        prisma.vacancy.findUnique.mockResolvedValue({
          id: 'v1',
          organizationId: ORG_A,
          status,
          title: 't',
          description: null,
          location: null,
          employmentType: null,
          requirements: [],
        });

        await build().process(syncJob());

        expect(ai.deleteVacancyIndex).toHaveBeenCalledWith('v1');
        expect(ai.indexVacancy).not.toHaveBeenCalled();
      },
    );

    it('a deleted vacancy is removed from the index (idempotent sync)', async () => {
      prisma.vacancy.findUnique.mockResolvedValue(null);

      await build().process(syncJob());

      expect(ai.deleteVacancyIndex).toHaveBeenCalledWith('v1');
    });
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

    it('an org document deleted mid-indexing is evicted, not completed', async () => {
      // First read (ownership) sees the document; the post-indexing
      // existence check does not — HR deleted it while the AI call ran.
      prisma.document.findFirst
        .mockResolvedValueOnce(DOCUMENT)
        .mockResolvedValueOnce(null);

      await build().process(makeJob());

      expect(ai.deleteDocument).toHaveBeenCalledWith(ORG_A, 'd1');
      expect(processing.markCompleted).not.toHaveBeenCalled();
    });

    it('an org document deleted before the job ran is evicted and stopped for good', async () => {
      prisma.document.findFirst.mockResolvedValue(null);

      await expect(build().process(makeJob())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(ai.deleteDocument).toHaveBeenCalledWith(ORG_A, 'd1');
      expect(ai.processDocument).not.toHaveBeenCalled();
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
  describe('candidate link jobs (personal, network-fetching path)', () => {
    const linkJob = (over: Record<string, unknown> = {}) =>
      ({
        name: 'PROCESS_CANDIDATE_LINK',
        data: { linkId: 'link-1', candidateAccountId: 'acct-1' },
        attemptsMade: 0,
        ...over,
      }) as never;

    it('verifies OWNERSHIP before fetching anything', async () => {
      await build().process(linkJob());

      expect(prisma.candidateLink.findFirst.mock.calls[0][0].where).toEqual({
        id: 'link-1',
        candidateAccountId: 'acct-1',
      });
    });

    it('walks the row through FETCHING then PROCESSING then COMPLETED', async () => {
      await build().process(linkJob());

      const statuses = prisma.candidateLink.updateMany.mock.calls.map(
        (call: any[]) => call[0].data.status,
      );
      expect(statuses).toEqual(['FETCHING', 'PROCESSING', 'COMPLETED']);
    });

    it('skips re-indexing when a refresh finds the page unchanged', async () => {
      // The hash is over the normalized text, so an identical hash means the
      // stored vectors are already exactly right.
      prisma.candidateLink.findFirst.mockResolvedValue({
        ...LINK,
        status: 'COMPLETED',
        contentHash: INGESTED.contentHash,
      });

      await build().process(linkJob());

      expect(ai.indexPersonalWebSource).not.toHaveBeenCalled();
      const final = prisma.candidateLink.updateMany.mock.calls.at(-1)[0].data;
      expect(final.status).toBe('COMPLETED');
      expect(final.lastFetchedAt).toBeInstanceOf(Date);
    });

    it('re-indexes unchanged content when the previous attempt had FAILED', async () => {
      // A matching hash says nothing about whether the vectors exist; skipping
      // here would leave the link permanently unsearchable.
      prisma.candidateLink.findFirst.mockResolvedValue({
        ...LINK,
        status: 'FAILED',
        contentHash: INGESTED.contentHash,
      });

      await build().process(linkJob());

      expect(ai.indexPersonalWebSource).toHaveBeenCalled();
    });

    it('re-indexes when the page has changed', async () => {
      prisma.candidateLink.findFirst.mockResolvedValue({
        ...LINK,
        status: 'COMPLETED',
        contentHash: 'b'.repeat(64),
      });

      await build().process(linkJob());

      expect(ai.indexPersonalWebSource).toHaveBeenCalled();
    });

    it('CHANGED content invalidates anything generated from the old content', async () => {
      // A refreshed link now says something different, so a Job Match computed
      // against the previous version is no longer a description of this
      // candidate's evidence.
      prisma.candidateLink.findFirst.mockResolvedValue({
        ...LINK,
        status: 'COMPLETED',
        contentHash: 'b'.repeat(64),
      });

      await build().process(linkJob());

      expect(prisma.candidateAccount.update).toHaveBeenCalledWith({
        where: { id: LINK.candidateAccountId },
        data: { evidenceRevision: { increment: 1 } },
      });
    });

    it('UNCHANGED content does not invalidate anything', async () => {
      // Pressing Refresh on a page that has not moved must not make a perfectly
      // good analysis look stale.
      prisma.candidateLink.findFirst.mockResolvedValue({
        ...LINK,
        status: 'COMPLETED',
        contentHash: INGESTED.contentHash,
      });

      await build().process(linkJob());

      expect(prisma.candidateAccount.update).not.toHaveBeenCalled();
    });

    it('persists the extracted content so apply can freeze it later', async () => {
      await build().process(linkJob());

      const final = prisma.candidateLink.updateMany.mock.calls.at(-1)[0].data;
      expect(final.sections).toEqual(INGESTED.sections);
      expect(final.contentHash).toBe(INGESTED.contentHash);
      expect(final.pagesFetched).toBe(2);
      expect(final.fetchMode).toBe('STATIC');
      expect(final.lastFetchedAt).toBeInstanceOf(Date);
    });

    it('indexes into the PERSONAL collection, with no organization anywhere', async () => {
      await build().process(linkJob());

      expect(ai.indexApplicationWebSource).not.toHaveBeenCalled();
      const call = ai.indexPersonalWebSource.mock.calls[0][0];
      expect(call.candidateAccountId).toBe('acct-1');
      expect(call.sourceId).toBe('link-1');
      expect(call).not.toHaveProperty('organizationId');
    });

    it('titles an unlabelled link from the page, falling back to the host', async () => {
      await build().process(linkJob());
      expect(ai.indexPersonalWebSource.mock.calls[0][0].title).toBe(
        'Ji-woo Han',
      );

      web.ingest.mockResolvedValue({ ...INGESTED, title: null });
      await build().process(linkJob());
      expect(ai.indexPersonalWebSource.mock.calls[1][0].title).toBe(
        'portfolio.example.com',
      );
    });

    it("prefers the candidate's own label over the page title", async () => {
      prisma.candidateLink.findFirst.mockResolvedValue({
        ...LINK,
        title: 'My portfolio',
      });
      await build().process(linkJob());
      expect(ai.indexPersonalWebSource.mock.calls[0][0].title).toBe(
        'My portfolio',
      );
    });

    it('records a typed failure and does NOT retry a permanent one', async () => {
      web.ingest.mockRejectedValue(
        new WebIngestionError(
          LinkFailureCode.PRIVATE_NETWORK_URL,
          'resolves to a private address',
        ),
      );

      await expect(build().process(linkJob())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      const failure = prisma.candidateLink.updateMany.mock.calls.at(-1)[0].data;
      expect(failure.status).toBe('FAILED');
      expect(failure.failureCode).toBe(LinkFailureCode.PRIVATE_NETWORK_URL);
    });

    it('records a typed failure and DOES retry a transient one', async () => {
      web.ingest.mockRejectedValue(
        new WebIngestionError(LinkFailureCode.FETCH_TIMEOUT, 'timed out'),
      );

      // Not UnrecoverableError: BullMQ should try again with backoff.
      const error = await build()
        .process(linkJob())
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(WebIngestionError);
      expect(error).not.toBeInstanceOf(UnrecoverableError);
    });

    it('never reports COMPLETED when nothing was indexed', async () => {
      ai.indexPersonalWebSource.mockResolvedValue({
        sourceId: 'link-1',
        chunksCreated: 0,
        vectorsIndexed: 0,
        durationMs: 10,
      });

      await expect(build().process(linkJob())).rejects.toThrow();
      const failure = prisma.candidateLink.updateMany.mock.calls.at(-1)[0].data;
      expect(failure.failureCode).toBe(LinkFailureCode.INDEXING_FAILED);
    });

    it('evicts vectors when the link was deleted after the job was queued', async () => {
      prisma.candidateLink.findFirst.mockResolvedValue(null);

      await expect(build().process(linkJob())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(ai.deletePersonalWebSource).toHaveBeenCalledWith(
        'acct-1',
        'link-1',
      );
    });

    it('evicts vectors when the link is deleted MID-processing', async () => {
      // The delete's own eviction may have run before these vectors existed,
      // so the deletion has to stay authoritative.
      prisma.candidateLink.updateMany.mockResolvedValue({ count: 0 });

      await build().process(linkJob());
      expect(ai.deletePersonalWebSource).toHaveBeenCalledWith(
        'acct-1',
        'link-1',
      );
    });

    it('evicts on the delete job', async () => {
      await build().process({
        name: 'DELETE_CANDIDATE_LINK_INDEX',
        data: { linkId: 'link-1', candidateAccountId: 'acct-1' },
      } as never);
      expect(ai.deletePersonalWebSource).toHaveBeenCalledWith(
        'acct-1',
        'link-1',
      );
    });
  });

  describe('the removed application-link snapshot path', () => {
    it('refuses a job for the job type that no longer exists', async () => {
      // Apply stopped copying evidence, so nothing enqueues this any more —
      // but a job left in Redis from before the migration would still be
      // delivered once. It must be rejected outright rather than silently
      // succeeding, which is what an unhandled name does here.
      const stale = {
        name: 'PROCESS_APPLICATION_LINK',
        data: {
          linkSourceId: 'link-src-1',
          organizationId: ORG_A,
          candidateId: 'cand-1',
        },
        attemptsMade: 0,
      } as never;

      await expect(build().process(stale)).rejects.toThrow(/Unknown job/i);
    });
  });
});
