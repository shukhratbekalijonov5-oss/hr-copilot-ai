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

/** One personal file as apply sees it. */
const personalDocument = (id: string, name: string) => ({
  id,
  storageKey: `candidate/${MY_ACCOUNT}/documents/${id}.pdf`,
  originalFileName: name,
  mimeType: 'application/pdf',
  type: 'RESUME',
});

/** One COMPLETED personal link as apply sees it. */
const personalLink = (id: string, url: string) => ({
  id,
  url,
  normalizedUrl: url.replace(/^https:\/\//, '').replace(/\/$/, ''),
  title: 'Portfolio Website',
  detectedType: 'WEBSITE',
  sections: [
    { name: 'projects', heading: 'Projects', text: 'Kubernetes work', url },
  ],
  contentHash: 'hash-1',
  charCount: 800,
  pagesFetched: 2,
  fetchMode: 'STATIC',
  lastFetchedAt: new Date('2026-08-20T00:00:00Z'),
});

function createPrismaMock() {
  const tx = {
    candidate: { upsert: jest.fn() },
    document: { create: jest.fn(), updateMany: jest.fn() },
    // update/delete exist only so the history test can assert they are never
    // called: the apply path must append an attempt, never rewrite an old one.
    application: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    applicationLinkSource: { create: jest.fn() },
  };
  return {
    tx,
    vacancy: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    candidate: { findUnique: jest.fn() },
    application: { findUnique: jest.fn(), findFirst: jest.fn() },
    document: { findUnique: jest.fn(), findMany: jest.fn() },
    applicationLinkSource: { updateMany: jest.fn() },
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
  let producer: {
    enqueueDocument: jest.Mock;
    enqueueApplicationLink: jest.Mock;
  };
  let accounts: { requireAccount: jest.Mock };
  let links: { listSubmittableLinks: jest.Mock };
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
    producer = {
      enqueueDocument: jest.fn().mockResolvedValue('bull-1'),
      enqueueApplicationLink: jest.fn().mockResolvedValue('bull-link-1'),
    };
    links = { listSubmittableLinks: jest.fn().mockResolvedValue([]) };
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
      links as never,
      events as never,
    );

    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'Jasur Toshmatov',
      email: 'jasur@example.test',
    });
    prisma.document.findMany.mockResolvedValue([
      personalDocument('personal-doc-1', 'resume.pdf'),
    ]);
    prisma.tx.candidate.upsert.mockResolvedValue({ id: 'cand-1' });
    prisma.tx.applicationLinkSource.create.mockImplementation(() =>
      Promise.resolve({ id: `link-src-${Math.random()}` }),
    );
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
      prisma.application.findFirst.mockResolvedValue(null);
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

    it('still requires a resume even when links are ready to submit', async () => {
      // Links SUPPLEMENT evidence; they do not replace the document the
      // product has always required to apply. Changing that is a separate
      // product decision, not a side effect of adding links.
      accounts.requireAccount.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: null,
      });
      links.listSubmittableLinks.mockResolvedValue([
        personalLink('link-1', 'https://portfolio.example.com/'),
      ]);

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.tx.applicationLinkSource.create).not.toHaveBeenCalled();
    });

    /**
     * Re-application after rejection.
     *
     * REJECTED ends an ATTEMPT, not the candidate's relationship with the
     * role. The duplicate guard therefore asks "is there a LIVE attempt?",
     * not "has this person ever applied?" — and the old rejected row is never
     * read for anything but that decision, so history stays intact.
     */
    describe('re-application after a rejection', () => {
      const EXISTING_CANDIDATE = { id: 'cand-1' };

      it('blocks a second application while the first is still live', async () => {
        prisma.candidate.findUnique.mockResolvedValue(EXISTING_CANDIDATE);
        prisma.application.findFirst.mockResolvedValue({ id: 'app-live' });

        await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(prisma.tx.application.create).not.toHaveBeenCalled();
      });

      it('only counts NON-rejected attempts as blocking', async () => {
        prisma.candidate.findUnique.mockResolvedValue(EXISTING_CANDIDATE);
        prisma.application.findFirst.mockResolvedValue(null);

        await service.apply(ME, SLUG);

        // The question asked of the database is the whole fix: any attempt
        // whose status is not REJECTED.
        const where = prisma.application.findFirst.mock.calls[0][0].where;
        expect(where).toMatchObject({
          vacancyId: 'vac-1',
          candidateId: EXISTING_CANDIDATE.id,
          status: { not: ApplicationStatus.REJECTED },
        });
      });

      it('allows a new application when every previous attempt was rejected', async () => {
        prisma.candidate.findUnique.mockResolvedValue(EXISTING_CANDIDATE);
        // No live attempt — the rejected one does not match the filter.
        prisma.application.findFirst.mockResolvedValue(null);

        const result = await service.apply(ME, SLUG);

        expect((result as { id: string }).id).toBe('app-1');
        expect(prisma.tx.application.create).toHaveBeenCalledTimes(1);
      });

      it('starts the new attempt at the normal initial status, as its own row', async () => {
        prisma.candidate.findUnique.mockResolvedValue(EXISTING_CANDIDATE);
        prisma.application.findFirst.mockResolvedValue(null);

        await service.apply(ME, SLUG);

        const data = prisma.tx.application.create.mock.calls[0][0].data;
        expect(data.status).toBe(ApplicationStatus.NEW);
        expect(data.source).toBe(ApplicationSource.DIRECT);
        // A fresh row: no id is carried over and no createdAt is forced.
        expect(data).not.toHaveProperty('id');
        expect(data).not.toHaveProperty('createdAt');
      });

      it('never mutates or deletes the previous rejected application', async () => {
        prisma.candidate.findUnique.mockResolvedValue(EXISTING_CANDIDATE);
        prisma.application.findFirst.mockResolvedValue(null);

        await service.apply(ME, SLUG);

        // History is append-only here: the apply path may create, never
        // update or delete, an application.
        expect(prisma.tx.application.update).not.toHaveBeenCalled();
        expect(prisma.tx.application.delete).not.toHaveBeenCalled();
      });

      it('publishes the normal new-application event for the new attempt', async () => {
        prisma.candidate.findUnique.mockResolvedValue(EXISTING_CANDIDATE);
        prisma.application.findFirst.mockResolvedValue(null);

        await service.apply(ME, SLUG);

        // Re-applying is a real application: HR is notified exactly as they
        // were the first time, not suppressed because the person applied before.
        expect(events.publish).toHaveBeenCalledWith(
          'application.created',
          expect.objectContaining({ applicationId: 'app-1' }),
        );
      });
    });

    describe('multi-source evidence snapshot', () => {
      beforeEach(() => {
        prisma.document.findMany.mockResolvedValue([
          personalDocument('personal-doc-2', 'portfolio.pdf'),
          personalDocument('personal-doc-1', 'resume.pdf'),
          personalDocument('personal-doc-3', 'certificate.pdf'),
        ]);
        links.listSubmittableLinks.mockResolvedValue([
          personalLink('link-1', 'https://portfolio.example.com/'),
          personalLink('link-2', 'https://github.example.com/jiwoo'),
        ]);
      });

      it('copies EVERY personal file into the organization', async () => {
        await service.apply(ME, SLUG);

        expect(prisma.tx.document.create).toHaveBeenCalledTimes(3);
        const names = prisma.tx.document.create.mock.calls.map(
          (call) => call[0].data.originalFileName,
        );
        expect(names).toEqual(
          expect.arrayContaining([
            'resume.pdf',
            'portfolio.pdf',
            'certificate.pdf',
          ]),
        );
        // Every copy is org-owned; none of them is the personal original.
        for (const call of prisma.tx.document.create.mock.calls) {
          expect(call[0].data.organizationId).toBe(ORG_A);
          expect(call[0].data.candidateId).toBe('cand-1');
        }
      });

      it('names the profile resume as the application’s primary document', async () => {
        await service.apply(ME, SLUG);

        const primaryCopy = prisma.tx.document.create.mock.calls.find(
          (call) => call[0].data.originalFileName === 'resume.pdf',
        )![0].data;
        const app = prisma.tx.application.create.mock.calls[0][0].data;
        expect(app.submittedDocumentId).toBe(primaryCopy.id);
      });

      it('links every copy to the application for auditability', async () => {
        await service.apply(ME, SLUG);

        const update = prisma.tx.document.updateMany.mock.calls[0][0];
        expect(update.data.applicationId).toBe('app-1');
        expect(update.where.id.in).toHaveLength(3);
      });

      it('freezes each submitted link’s CONTENT, not a reference to it', async () => {
        await service.apply(ME, SLUG);

        expect(prisma.tx.applicationLinkSource.create).toHaveBeenCalledTimes(2);
        const snapshot =
          prisma.tx.applicationLinkSource.create.mock.calls[0][0].data;
        expect(snapshot.organizationId).toBe(ORG_A);
        expect(snapshot.applicationId).toBe('app-1');
        // The content itself is copied — this is what survives the candidate
        // later editing or deleting the personal link.
        expect(snapshot.sections).toEqual([
          expect.objectContaining({ text: 'Kubernetes work' }),
        ]);
        expect(snapshot.contentHash).toBe('hash-1');
        expect(snapshot.fetchedAt).toEqual(new Date('2026-08-20T00:00:00Z'));
        // A plain column, deliberately not a foreign key.
        expect(snapshot.sourceLinkId).toBe('link-1');
      });

      it('queues indexing for every file and every link', async () => {
        await service.apply(ME, SLUG);

        expect(producer.enqueueDocument).toHaveBeenCalledTimes(3);
        expect(producer.enqueueApplicationLink).toHaveBeenCalledTimes(2);
        expect(producer.enqueueApplicationLink.mock.calls[0][0]).toMatchObject({
          organizationId: ORG_A,
          candidateId: 'cand-1',
        });
      });

      it('submits nothing but COMPLETED links', async () => {
        // The rule lives in CandidateLinksService; apply must not second-guess
        // it by reaching for the table itself.
        await service.apply(ME, SLUG);
        expect(links.listSubmittableLinks).toHaveBeenCalledWith(MY_ACCOUNT);
      });

      it('cleans up every uploaded copy when the transaction fails', async () => {
        prisma.tx.application.create.mockRejectedValue({ code: 'P2002' });

        await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(storage.delete).toHaveBeenCalledTimes(3);
      });

      it('records a link snapshot as FAILED when its indexing cannot be queued', async () => {
        producer.enqueueApplicationLink.mockRejectedValue(
          new Error('redis down'),
        );

        const result = await service.apply(ME, SLUG);

        // The application still stands: rows are durable and recoverable.
        expect((result as { id: string }).id).toBe('app-1');
        expect(prisma.applicationLinkSource.updateMany).toHaveBeenCalled();
      });
    });

    it('applies with files only when the candidate has no links', async () => {
      links.listSubmittableLinks.mockResolvedValue([]);

      const result = await service.apply(ME, SLUG);

      expect((result as { id: string }).id).toBe('app-1');
      expect(prisma.tx.applicationLinkSource.create).not.toHaveBeenCalled();
      expect(producer.enqueueApplicationLink).not.toHaveBeenCalled();
    });

    it('409s a duplicate application while a live attempt exists (defined policy)', async () => {
      prisma.candidate.findUnique.mockResolvedValue({ id: 'cand-1' });
      // A LIVE attempt — any status other than REJECTED — still blocks.
      prisma.application.findFirst.mockResolvedValue({ id: 'existing-app' });

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
