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
import type { CandidateAccountService } from '../candidate-account/candidate-account.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const SLUG = 'senior-backend-engineer-northwind-abc123';
const ME = 'user-me';
const MY_ACCOUNT = 'acct-me';

/**
 * The profile resume as apply sees it: a LIVE personal row (organizationId
 * null, owned by the account). It is only ever READ — never copied.
 */
const LIVE_RESUME = { id: 'personal-doc-1' };

/**
 * The apply transaction.
 *
 * Every write the snapshot model used to perform is still mocked here on
 * purpose — `document.create`, `document.updateMany`, `candidateLink.create`.
 * "Applying copies nothing" is only provable if the copying writes remain
 * reachable and are observably never reached; a mock that simply omitted them
 * would prove nothing at all. (`applicationLinkSource` is absent because the
 * model no longer exists on the Prisma client: re-adding that write would not
 * even compile.)
 */
function createTxMock() {
  return {
    candidate: { upsert: jest.fn() },
    document: {
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    candidateLink: { create: jest.fn(), updateMany: jest.fn() },
    // update/delete exist only so the history test can assert they are never
    // called: the apply path must append an attempt, never rewrite an old one.
    application: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  };
}

/**
 * Which `model.method` writes the apply transaction actually performed.
 *
 * One assertion over this set is the whole regression guard of the snapshot
 * removal: an application is pure metadata, so the only rows it may write are
 * the org-side candidate association and the application itself.
 */
function txWrites(tx: ReturnType<typeof createTxMock>): string[] {
  return Object.entries(tx)
    .flatMap(([model, methods]) =>
      Object.entries(methods)
        .filter(([, fn]) => fn.mock.calls.length > 0)
        .map(([method]) => `${model}.${method}`),
    )
    .sort();
}

const ONLY_METADATA_WRITES = ['application.create', 'candidate.upsert'];

function createPrismaMock() {
  const tx = createTxMock();
  return {
    tx,
    vacancy: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    candidate: { findUnique: jest.fn() },
    application: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      // The applicant counter reads distinct (vacancy, candidate) pairs.
      findMany: jest.fn().mockResolvedValue([]),
    },
    // findFirst is the resume liveness probe. findMany is mocked but must never
    // be called: apply has no reason to enumerate a candidate's files now that
    // it copies none of them.
    document: { findFirst: jest.fn(), findMany: jest.fn() },
    candidateLink: { findMany: jest.fn() },
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
  let accounts: { requireAccount: jest.Mock };
  let service: PublicJobsService;
  let events: { publish: jest.Mock };
  let fx: { current: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    accounts = {
      requireAccount: jest.fn().mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: LIVE_RESUME.id,
        phone: '+998900000000',
        location: 'Tashkent',
        headline: 'Backend Engineer',
      }),
    };
    events = { publish: jest.fn() };
    // FX defaults to "no usable snapshot": a salary filter then works only in
    // the currency the candidate asked in, and everything unreadable is kept.
    fx = {
      current: jest.fn().mockResolvedValue({
        snapshot: null,
        freshness: 'UNAVAILABLE',
        ageMs: null,
        table: null,
      }),
    };
    service = new PublicJobsService(
      prisma as unknown as PrismaService,
      accounts as unknown as CandidateAccountService,
      events as never,
      fx as never,
    );

    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'Jasur Toshmatov',
      email: 'jasur@example.test',
    });
    prisma.document.findFirst.mockResolvedValue(LIVE_RESUME);
    prisma.document.findMany.mockResolvedValue([LIVE_RESUME]);
    prisma.candidateLink.findMany.mockResolvedValue([]);
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

    it('never RETURNS an internal field', async () => {
      // Asserted on what leaves the service rather than on the SELECT: `id` is
      // now read deliberately (the applicant count needs it, and it is the
      // ordering tie-break's companion) and stripped on the way out. Checking
      // the query would forbid reading it; checking the payload forbids
      // leaking it, which is the invariant that actually protects anyone.
      prisma.vacancy.findMany.mockResolvedValue([
        {
          id: 'vac-secret',
          publicSlug: 'a-job',
          title: 'A job',
          createdAt: new Date(),
        },
      ]);
      prisma.vacancy.count.mockResolvedValue(1);

      const { data } = await service.list({ page: 1, limit: 20, skip: 0 });

      expect(data).toHaveLength(1);
      const job = data[0] as Record<string, unknown>;
      for (const leaked of [
        'id',
        'createdBy',
        'createdById',
        'organizationId',
        '_count',
        'applications',
      ]) {
        expect(job).not.toHaveProperty(leaked);
      }
      expect(JSON.stringify(job)).not.toContain('vac-secret');

      const select = prisma.vacancy.findMany.mock.calls[0][0].select;
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

    it('creates the org-side candidate and an Application(source=DIRECT) — and nothing else', async () => {
      const result = await service.apply(ME, SLUG);

      // Org-side candidate linked to my account, one per org per account.
      const upsert = prisma.tx.candidate.upsert.mock.calls[0][0];
      expect(upsert.where.organizationId_candidateAccountId).toEqual({
        organizationId: ORG_A,
        candidateAccountId: MY_ACCOUNT,
      });
      // Reuse must not overwrite recruiter-enriched data.
      expect(upsert.update).toEqual({});

      const app = prisma.tx.application.create.mock.calls[0][0].data;
      expect(app.vacancyId).toBe('vac-1');
      expect(app.candidateId).toBe('cand-1');
      expect(app.source).toBe(ApplicationSource.DIRECT);
      expect(app.status).toBe(ApplicationStatus.NEW);

      expect((result as { id: string }).id).toBe('app-1');
      expect(txWrites(prisma.tx)).toEqual(ONLY_METADATA_WRITES);
    });

    it('reads the profile resume rather than duplicating it', async () => {
      await service.apply(ME, SLUG);

      // The liveness probe addresses the PERSONAL row: the candidate's own
      // copy, the only one that exists.
      expect(prisma.document.findFirst.mock.calls[0][0].where).toMatchObject({
        id: LIVE_RESUME.id,
        candidateAccountId: MY_ACCOUNT,
        organizationId: null,
      });
      expect(prisma.tx.document.create).not.toHaveBeenCalled();
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
      expect(txWrites(prisma.tx)).toEqual([]);
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
      // A null pointer is answered without asking the database anything.
      expect(prisma.document.findFirst).not.toHaveBeenCalled();
    });

    it('requires the profile resume to still EXIST, not merely be pointed at', async () => {
      // The account still names a resume, but the row is gone — the candidate
      // deleted the file after setting it as their profile resume. A dangling
      // pointer is not evidence: without the document there is nothing for a
      // recruiter to read, so the application is refused rather than created
      // empty.
      prisma.document.findFirst.mockResolvedValue(null);

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(txWrites(prisma.tx)).toEqual([]);
    });

    it('still requires a resume even when the candidate has links', async () => {
      // Links SUPPLEMENT evidence; they do not replace the document the
      // product has always required to apply. Changing that is a separate
      // product decision, not a side effect of adding links.
      accounts.requireAccount.mockResolvedValue({
        id: MY_ACCOUNT,
        resumeDocumentId: null,
      });
      prisma.candidateLink.findMany.mockResolvedValue([
        { id: 'link-1', url: 'https://portfolio.example.com/' },
      ]);

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(txWrites(prisma.tx)).toEqual([]);
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

      it('re-applying after a rejection ALSO copies nothing', async () => {
        // The old model made a fresh set of copies per attempt, so applying
        // three times left three duplicates of the same resume in the org. Now
        // a second attempt is a second row and nothing more — the recruiter
        // reads the same, single, current evidence they would have read the
        // first time.
        prisma.candidate.findUnique.mockResolvedValue(EXISTING_CANDIDATE);
        prisma.application.findFirst.mockResolvedValue(null);

        await service.apply(ME, SLUG);

        expect(txWrites(prisma.tx)).toEqual(ONLY_METADATA_WRITES);
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

    /**
     * The snapshot removal, stated as behaviour.
     *
     * Applying used to COPY the candidate's evidence into the organization: a
     * new storage object and org-owned Document per personal file, a frozen
     * ApplicationLinkSource per professional link, and an indexing job for each
     * of them in the org's Qdrant collection. That model is gone. There is ONE
     * copy of a candidate's evidence — their own — and a recruiter reads it
     * through the vacancy-contextual authorization chain instead.
     *
     * These are the inverse of the assertions that used to prove the copying
     * worked, and they are the central regression guard of the migration: any
     * re-introduction of a copy shows up here first.
     */
    describe('applying copies no evidence', () => {
      beforeEach(() => {
        // A candidate with a full corpus: three files and two links. Under the
        // old model this produced 3 documents + 2 link snapshots + 5 jobs.
        prisma.document.findMany.mockResolvedValue([
          { id: 'personal-doc-1' },
          { id: 'personal-doc-2' },
          { id: 'personal-doc-3' },
        ]);
        prisma.candidateLink.findMany.mockResolvedValue([
          { id: 'link-1' },
          { id: 'link-2' },
        ]);
      });

      it('copies NO personal file into the organization', async () => {
        await service.apply(ME, SLUG);

        expect(prisma.tx.document.create).not.toHaveBeenCalled();
        // It does not even enumerate them: there is nothing to select from.
        expect(prisma.document.findMany).not.toHaveBeenCalled();
      });

      it('freezes NO link: the recruiter reads the live CandidateLink', async () => {
        await service.apply(ME, SLUG);

        // Frozen `sections` were what survived a candidate editing or deleting
        // a link. That was the bug, not the feature: a withdrawn link must
        // stop being readable everywhere, so nothing is frozen and the link
        // table is not even consulted at apply time.
        expect(prisma.tx.candidateLink.create).not.toHaveBeenCalled();
        expect(prisma.candidateLink.findMany).not.toHaveBeenCalled();
      });

      it('names no submitted document on the application', async () => {
        await service.apply(ME, SLUG);

        // `submittedDocumentId` pointed at the org-side copy of the resume.
        // With no copy there is nothing to point at — and nothing needs to,
        // because the account's current resume is what gets read.
        const data = prisma.tx.application.create.mock.calls[0][0].data;
        expect(data).not.toHaveProperty('submittedDocumentId');
      });

      it('stamps no applicationId onto any document', async () => {
        await service.apply(ME, SLUG);

        // Document lineage back to an application only existed to audit the
        // copies. No copies, no lineage write.
        expect(prisma.tx.document.updateMany).not.toHaveBeenCalled();
      });

      it('queues no indexing: the candidate corpus is already indexed', async () => {
        await service.apply(ME, SLUG);

        /*
         * Structural, not incidental: nothing that could move bytes or queue
         * work is injectable here, so no apply can upload or enqueue anything.
         *
         * Asserted against the constructor SOURCE rather than its arity — an
         * arity check breaks every time a legitimate read-only collaborator is
         * added (FxRateService, for one) while saying nothing about what the
         * new dependency can actually do.
         */
        const constructorSource = PublicJobsService.toString().slice(
          0,
          PublicJobsService.toString().indexOf('}'),
        );
        for (const forbidden of [
          'StorageService',
          'storage',
          'Producer',
          'producer',
          'ProcessingService',
        ]) {
          expect(constructorSource).not.toContain(forbidden);
        }
        expect(txWrites(prisma.tx)).toEqual(ONLY_METADATA_WRITES);
      });

      it('keeps exactly one evidence corpus across N applications', async () => {
        // The point of the migration: applying to twenty vacancies stores one
        // resume and twenty application rows, not twenty resumes.
        await service.apply(ME, SLUG);
        prisma.vacancy.findFirst.mockResolvedValue({
          id: 'vac-2',
          organizationId: ORG_B,
        });
        await service.apply(ME, 'another-job-slug-def456');
        prisma.vacancy.findFirst.mockResolvedValue({
          id: 'vac-3',
          organizationId: ORG_A,
        });
        await service.apply(ME, 'third-job-slug-ghi789');

        expect(prisma.tx.application.create).toHaveBeenCalledTimes(3);
        expect(prisma.tx.document.create).not.toHaveBeenCalled();
        expect(txWrites(prisma.tx)).toEqual(ONLY_METADATA_WRITES);
      });
    });

    it('applies identically whether or not the candidate has links', async () => {
      // Links used to change the shape of an apply (extra rows, extra jobs).
      // Now they are irrelevant to it: the same two rows are written either
      // way, and HR sees the links because they are the candidate's, not
      // because the application carried them.
      prisma.candidateLink.findMany.mockResolvedValue([]);

      const result = await service.apply(ME, SLUG);

      expect((result as { id: string }).id).toBe('app-1');
      expect(txWrites(prisma.tx)).toEqual(ONLY_METADATA_WRITES);
    });

    it('409s a duplicate application while a live attempt exists (defined policy)', async () => {
      prisma.candidate.findUnique.mockResolvedValue({ id: 'cand-1' });
      // A LIVE attempt — any status other than REJECTED — still blocks.
      prisma.application.findFirst.mockResolvedValue({ id: 'existing-app' });

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        ConflictException,
      );
      // Rejected BEFORE any row is written.
      expect(txWrites(prisma.tx)).toEqual([]);
    });

    it('maps a concurrent double-submit (unique violation) to 409', async () => {
      prisma.tx.application.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('publishes nothing when the application is not committed', async () => {
      prisma.tx.application.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.apply(ME, SLUG)).rejects.toBeInstanceOf(
        ConflictException,
      );
      // A rolled-back apply must leave no ghost notification behind. (There is
      // no storage object to clean up any more — the failed transaction is the
      // entire cleanup.)
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('notifies the vacancy organization once the application is committed', async () => {
      await service.apply(ME, SLUG);

      expect(events.publish).toHaveBeenCalledWith('application.created', {
        organizationId: ORG_A,
        vacancyId: 'vac-1',
        applicationId: 'app-1',
        candidateId: 'cand-1',
      });
    });
  });
});
