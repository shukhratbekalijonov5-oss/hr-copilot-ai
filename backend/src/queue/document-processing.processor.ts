import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import {
  DELETE_APPLICATION_LINK_INDEX_JOB,
  DELETE_CANDIDATE_LINK_INDEX_JOB,
  DELETE_PERSONAL_RESUME_INDEX_JOB,
  PROCESSING_PROGRESS,
  PROCESS_APPLICATION_LINK_JOB,
  PROCESS_CANDIDATE_LINK_JOB,
  PROCESS_PERSONAL_RESUME_JOB,
  RESUME_PROCESSING_QUEUE,
  SYNC_VACANCY_INDEX_JOB,
  type ApplicationLinkJobData,
  type CandidateLinkJobData,
  type PersonalResumeJobData,
  type ProcessDocumentJobData,
  type ResumeQueueJobData,
  type SyncVacancyIndexJobData,
} from './queue.constants';
import { ProcessingService } from '../processing/processing.service';
import {
  AiServiceClient,
  AiServiceDisabledError,
} from '../ai/ai-service.client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  WebIngestionService,
  type IngestedWebSource,
} from '../web-ingestion/web-ingestion.service';
import {
  WebIngestionError,
  linkFailureIsRetryable,
} from '../web-ingestion/web-ingestion.errors';
import {
  fromJsonSections,
  toAiSections,
  toJsonSections,
} from '../web-ingestion/stored-sections';
import { hostnameOf } from '../web-ingestion/url-policy';
import {
  DocumentStatus,
  LinkFailureCode,
  LinkStatus,
} from '../generated/prisma/enums';

/**
 * Drives one document through the processing lifecycle.
 *
 * Division of responsibility:
 *   - This worker owns orchestration and the terminal states (COMPLETED /
 *     FAILED). It is the source of truth for whether the job succeeded.
 *   - The AI service owns the intermediate stages, and reports each one back
 *     through /internal/processing/progress as it genuinely completes. That is
 *     why the worker does not write PARSING..INDEXING itself: doing so around a
 *     single HTTP call would be inventing progress it cannot observe.
 *
 * A document only reaches COMPLETED after the AI service has really parsed,
 * embedded and indexed it. While the AI service is unconfigured the job fails
 * fast and honestly.
 */
@Processor(RESUME_PROCESSING_QUEUE, { concurrency: 2 })
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  constructor(
    private readonly processing: ProcessingService,
    private readonly ai: AiServiceClient,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly web: WebIngestionService,
  ) {
    super();
  }

  async process(job: Job<ResumeQueueJobData>): Promise<void> {
    switch (job.name) {
      case PROCESS_PERSONAL_RESUME_JOB:
        return this.processPersonalResume(job.data as PersonalResumeJobData);
      case DELETE_PERSONAL_RESUME_INDEX_JOB:
        return this.deletePersonalResumeIndex(
          job.data as PersonalResumeJobData,
        );
      case PROCESS_CANDIDATE_LINK_JOB:
        return this.processCandidateLink(job.data as CandidateLinkJobData);
      case DELETE_CANDIDATE_LINK_INDEX_JOB:
        return this.deleteCandidateLinkIndex(job.data as CandidateLinkJobData);
      case PROCESS_APPLICATION_LINK_JOB:
        return this.processApplicationLink(job.data as ApplicationLinkJobData);
      case DELETE_APPLICATION_LINK_INDEX_JOB:
        return this.deleteApplicationLinkIndex(
          job.data as ApplicationLinkJobData,
        );
      case SYNC_VACANCY_INDEX_JOB:
        return this.syncVacancyIndex(job.data as SyncVacancyIndexJobData);
      default:
        return this.processOrgDocument(job as Job<ProcessDocumentJobData>);
    }
  }

  /**
   * PERSONAL professional link → fetch, extract, index into the
   * candidate-scoped collection.
   *
   * Two things distinguish this from the document path. First, the slow part
   * is an outbound request to a machine nobody here controls, so it is
   * bounded by WebIngestionService and its failures are TYPED — a
   * private-network target is not the same event as a timeout, and only one of
   * them is worth retrying. Second, the extracted content is persisted on the
   * row: apply has to freeze exactly what the AI saw, and re-fetching later
   * would freeze something else.
   */
  private async processCandidateLink(
    data: CandidateLinkJobData,
  ): Promise<void> {
    const { linkId, candidateAccountId } = data;

    if (!this.ai.enabled) {
      await this.failLink(
        data,
        LinkFailureCode.INDEXING_FAILED,
        'AI service is not configured (AI_SERVICE_URL is unset)',
      );
      throw new UnrecoverableError('AI service is not configured');
    }

    // Ownership is re-read rather than trusted from the payload, exactly as
    // the document path does: a malformed job cannot cross accounts.
    const link = await this.prisma.candidateLink.findFirst({
      where: { id: linkId, candidateAccountId },
    });
    if (!link) {
      // Deleted after enqueue, or between attempts when an earlier attempt may
      // already have indexed. Evict (idempotent) so a delete can never leave
      // stale personal vectors behind.
      await this.ai.deletePersonalWebSource(candidateAccountId, linkId);
      throw new UnrecoverableError(
        `Link ${linkId} no longer exists for this account`,
      );
    }

    // Captured before the status is moved: it is what says whether the
    // CURRENT vectors are trustworthy, which the unchanged-content skip below
    // depends on.
    const wasCompleted = link.status === LinkStatus.COMPLETED;

    await this.prisma.candidateLink.updateMany({
      where: { id: linkId, candidateAccountId },
      data: { status: LinkStatus.FETCHING },
    });

    // Explicitly typed: an inferred `let` assigned inside a try block widens
    // to `any`, which quietly removes every guarantee the ingestion contract
    // makes about what comes back.
    let ingested: IngestedWebSource;
    try {
      ingested = await this.web.ingest(link.url, { label: `link=${linkId}` });
    } catch (error) {
      const code =
        error instanceof WebIngestionError
          ? error.code
          : LinkFailureCode.UPSTREAM_ERROR;
      await this.failLink(
        data,
        code,
        error instanceof Error ? error.message : 'Unknown fetch error',
      );
      // Only transient classes go back on the queue. Retrying a blocked
      // private address or an unsupported protocol can only fail identically,
      // and would hammer someone else's server for nothing.
      if (!linkFailureIsRetryable(code)) {
        throw new UnrecoverableError(
          `Link ${linkId} failed permanently: ${code}`,
        );
      }
      throw error;
    }

    // A REFRESH of a page that has not changed needs no work: the content hash
    // is over the normalized extracted text, so an identical hash means the
    // existing chunks and vectors are already exactly right. Re-embedding them
    // would burn CPU to produce the same numbers.
    //
    // Gated on the PRE-refresh status: a hash can match while the previous
    // attempt failed to index, and skipping then would leave the link
    // permanently unsearchable.
    if (
      wasCompleted &&
      link.contentHash &&
      link.contentHash === ingested.contentHash
    ) {
      await this.prisma.candidateLink.updateMany({
        where: { id: linkId, candidateAccountId },
        data: { status: LinkStatus.COMPLETED, lastFetchedAt: new Date() },
      });
      this.logger.log(
        `Candidate link ${linkId} is unchanged since the last fetch; ` +
          're-indexing skipped',
      );
      return;
    }

    await this.prisma.candidateLink.updateMany({
      where: { id: linkId, candidateAccountId },
      data: { status: LinkStatus.PROCESSING },
    });

    const title = link.title?.trim() || ingested.title || hostnameOf(link.url);
    try {
      const result = await this.ai.indexPersonalWebSource({
        candidateAccountId,
        sourceId: linkId,
        title,
        url: link.url,
        detectedType: ingested.detectedType,
        sections: toAiSections(ingested.sections),
      });
      if (result.vectorsIndexed <= 0) {
        throw new Error('AI service indexed no vectors');
      }
    } catch (error) {
      await this.failLink(
        data,
        LinkFailureCode.INDEXING_FAILED,
        error instanceof Error ? error.message : 'Unknown indexing error',
      );
      throw error;
    }

    const updated = await this.prisma.candidateLink.updateMany({
      where: { id: linkId, candidateAccountId },
      data: {
        status: LinkStatus.COMPLETED,
        failureCode: null,
        failureMessage: null,
        title,
        detectedType: ingested.detectedType,
        sections: toJsonSections(ingested.sections),
        contentHash: ingested.contentHash,
        charCount: ingested.charCount,
        pagesFetched: ingested.pagesFetched,
        fetchMode: ingested.fetchMode,
        lastFetchedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      // Deleted while the fetch was in flight: the delete's own eviction may
      // have run BEFORE the vectors above were written. Remove them now — a
      // deletion stays authoritative.
      await this.ai.deletePersonalWebSource(candidateAccountId, linkId);
      this.logger.log(
        `Link ${linkId} was deleted mid-processing; freshly indexed vectors evicted`,
      );
      return;
    }

    // The link now says something different from what it said before, so any
    // Job Match generated against the old content is no longer a description
    // of this candidate's evidence. (Reached only when the content actually
    // changed — an unchanged re-fetch returns above without touching this.)
    await this.prisma.candidateAccount
      .update({
        where: { id: candidateAccountId },
        data: { evidenceRevision: { increment: 1 } },
      })
      .catch((error: unknown) => {
        // A missed bump makes one stale result look current for a cycle;
        // failing the indexing job over it would be worse.
        this.logger.warn(
          `Indexed link ${linkId} but could not bump the evidence revision: ` +
            `${(error as Error).message}`,
        );
      });

    this.logger.log(
      `Candidate link ${linkId} indexed: ${ingested.sections.length} section(s), ` +
        `${ingested.pagesFetched} page(s), mode ${ingested.fetchMode}`,
    );
  }

  private async deleteCandidateLinkIndex(
    data: CandidateLinkJobData,
  ): Promise<void> {
    if (!this.ai.enabled) return;
    await this.ai.deletePersonalWebSource(data.candidateAccountId, data.linkId);
    this.logger.log(
      `Candidate link ${data.linkId} removed from the personal index`,
    );
  }

  /**
   * ORG-scoped application link snapshot → tenant index.
   *
   * Deliberately performs NO network request. The content was frozen when the
   * candidate applied and lives on the row; re-fetching here would silently
   * replace an application's evidence with whatever the site says today, which
   * is the exact failure the snapshot model exists to prevent.
   */
  private async processApplicationLink(
    data: ApplicationLinkJobData,
  ): Promise<void> {
    const { linkSourceId, organizationId, candidateId } = data;

    if (!this.ai.enabled) {
      throw new UnrecoverableError('AI service is not configured');
    }

    const source = await this.prisma.applicationLinkSource.findFirst({
      where: { id: linkSourceId, organizationId },
    });
    if (!source) {
      await this.ai.deleteApplicationWebSource(organizationId, linkSourceId);
      throw new UnrecoverableError(
        `Application link source ${linkSourceId} no longer exists`,
      );
    }

    try {
      const result = await this.ai.indexApplicationWebSource({
        organizationId,
        candidateId,
        applicationId: source.applicationId,
        sourceId: source.id,
        title: source.title ?? hostnameOf(source.url),
        url: source.url,
        detectedType: source.detectedType,
        sections: toAiSections(fromJsonSections(source.sections)),
      });
      if (result.vectorsIndexed <= 0) {
        throw new Error('AI service indexed no vectors');
      }
    } catch (error) {
      await this.prisma.applicationLinkSource.updateMany({
        where: { id: linkSourceId, organizationId },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage: (error as Error).message.slice(0, 500),
        },
      });
      throw error;
    }

    const updated = await this.prisma.applicationLinkSource.updateMany({
      where: { id: linkSourceId, organizationId },
      data: { status: DocumentStatus.COMPLETED, errorMessage: null },
    });
    if (updated.count === 0) {
      await this.ai.deleteApplicationWebSource(organizationId, linkSourceId);
      return;
    }
    this.logger.log(`Application link source ${linkSourceId} indexed`);
  }

  private async deleteApplicationLinkIndex(
    data: ApplicationLinkJobData,
  ): Promise<void> {
    if (!this.ai.enabled) return;
    await this.ai.deleteApplicationWebSource(
      data.organizationId,
      data.linkSourceId,
    );
    this.logger.log(
      `Application link source ${data.linkSourceId} removed from the tenant index`,
    );
  }

  /** Records a typed failure on the link row. Never throws. */
  private async failLink(
    data: CandidateLinkJobData,
    code: LinkFailureCode,
    detail: string,
  ): Promise<void> {
    await this.prisma.candidateLink
      .updateMany({
        where: { id: data.linkId, candidateAccountId: data.candidateAccountId },
        data: {
          status: LinkStatus.FAILED,
          failureCode: code,
          // Truncated and developer-facing; the UI localizes on failureCode.
          failureMessage: detail.slice(0, 500),
        },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Could not record failure for link ${data.linkId}: ${(error as Error).message}`,
        );
      });
  }

  /**
   * PERSONAL resume → candidate-scoped index. Deliberately different from the
   * org path: no ProcessingJob row and no websocket progress (there is no
   * recruiter processing UI for personal documents) — the Document row's
   * status is the whole lifecycle. And no organization anywhere.
   */
  private async processPersonalResume(
    data: PersonalResumeJobData,
  ): Promise<void> {
    const { documentId, candidateAccountId } = data;
    try {
      if (!this.ai.enabled) {
        throw new UnrecoverableError(
          'AI service is not configured (AI_SERVICE_URL is unset)',
        );
      }
      // Re-read and verify OWNERSHIP: the document must be a personal one
      // belonging to exactly this candidate account.
      const document = await this.prisma.document.findFirst({
        where: { id: documentId, candidateAccountId, organizationId: null },
        select: {
          id: true,
          originalFileName: true,
          storageKey: true,
          mimeType: true,
        },
      });
      if (!document) {
        // Tombstone: the document was deleted after this job was enqueued —
        // or between attempts, in which case an EARLIER attempt may already
        // have indexed vectors. Evict (idempotent) before giving up so a
        // delete can never leave stale personal vectors behind. If the
        // eviction call itself fails, the thrown error is retryable and
        // BullMQ tries again.
        await this.ai.deletePersonalResume(candidateAccountId, documentId);
        throw new UnrecoverableError(
          `Personal document ${documentId} no longer exists for this account`,
        );
      }

      const content = await this.storage.getObject(document.storageKey);
      const result = await this.ai.processPersonalResume({
        documentId: document.id,
        candidateAccountId,
        fileName: document.originalFileName,
        content,
        mimeType: document.mimeType,
      });
      if (result.vectorsIndexed <= 0) {
        throw new Error(
          `AI service indexed no vectors for personal document ${documentId}`,
        );
      }

      const updated = await this.prisma.document.updateMany({
        where: { id: documentId, candidateAccountId },
        data: { status: DocumentStatus.COMPLETED, pageCount: result.pageCount },
      });
      if (updated.count === 0) {
        // Deleted while indexing was in flight: the delete's own eviction may
        // have run BEFORE the vectors above were written. Remove them now so
        // the deletion stays authoritative — nothing may resurrect a deleted
        // document's evidence.
        await this.ai.deletePersonalResume(candidateAccountId, documentId);
        this.logger.log(
          `Personal resume ${documentId} was deleted mid-processing; freshly indexed vectors evicted`,
        );
        return;
      }
      this.logger.log(
        `Personal resume ${documentId} indexed: ${result.vectorsIndexed} vector(s)`,
      );
    } catch (error) {
      await this.prisma.document.updateMany({
        where: { id: documentId, candidateAccountId },
        data: { status: DocumentStatus.FAILED },
      });
      throw error;
    }
  }

  private async deletePersonalResumeIndex(
    data: PersonalResumeJobData,
  ): Promise<void> {
    if (!this.ai.enabled) return;
    await this.ai.deletePersonalResume(
      data.candidateAccountId,
      data.documentId,
    );
    this.logger.log(
      `Personal resume ${data.documentId} removed from the candidate index`,
    );
  }

  /**
   * Reconciles one vacancy with the candidate-discoverable index from the
   * CURRENT database state: OPEN → (re)index its candidate-visible fields;
   * anything else (draft, closed, archived, deleted) → remove it. Firing this
   * repeatedly, out of order, or after deletion always converges.
   */
  private async syncVacancyIndex(data: SyncVacancyIndexJobData): Promise<void> {
    if (!this.ai.enabled) {
      throw new UnrecoverableError(
        'AI service is not configured (AI_SERVICE_URL is unset)',
      );
    }
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id: data.vacancyId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        title: true,
        description: true,
        location: true,
        employmentType: true,
        requirements: { select: { text: true, required: true } },
      },
    });

    if (!vacancy || vacancy.status !== 'OPEN') {
      await this.ai.deleteVacancyIndex(data.vacancyId);
      this.logger.log(`Vacancy ${data.vacancyId} removed from the job index`);
      return;
    }

    // Candidate-visible fields ONLY — the select above is the allow-list; no
    // recruiter-side counts, notes or creator data are ever sent.
    await this.ai.indexVacancy({
      vacancyId: vacancy.id,
      organizationId: vacancy.organizationId,
      status: vacancy.status,
      title: vacancy.title,
      description: vacancy.description,
      location: vacancy.location,
      employmentType: vacancy.employmentType,
      requirements: vacancy.requirements,
    });
    this.logger.log(`Vacancy ${data.vacancyId} indexed for job matching`);
  }

  private async processOrgDocument(
    job: Job<ProcessDocumentJobData>,
  ): Promise<void> {
    const { documentId, organizationId } = job.data;
    const attempts = job.attemptsMade + 1;

    try {
      if (!this.ai.enabled) {
        // Honest stop, not a fake success. Unrecoverable: retrying cannot
        // configure the service.
        throw new UnrecoverableError(
          'AI service is not configured (AI_SERVICE_URL is unset); document ' +
            'parsing cannot run yet',
        );
      }

      // Re-read from the database rather than trusting the job payload, and
      // scope by organization so a malformed job cannot cross tenants.
      const document = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
        select: {
          id: true,
          organizationId: true,
          candidateId: true,
          originalFileName: true,
          storageKey: true,
          mimeType: true,
          type: true,
        },
      });

      if (!document) {
        // Deleted after enqueue (or between attempts, when an earlier attempt
        // may already have indexed vectors). Evict — idempotent — so a delete
        // can never leave stale tenant vectors behind.
        await this.ai.deleteDocument(organizationId, documentId);
        throw new UnrecoverableError(
          `Document ${documentId} no longer exists in organization ${organizationId}`,
        );
      }

      const content = await this.storage.getObject(document.storageKey);

      // Stages PARSING -> INDEXING are written by the AI service's progress
      // callbacks while this call is in flight.
      const result = await this.ai.processDocument({
        documentId: document.id,
        // The job payload's organizationId — the document was fetched under
        // it, so they are equal, and (unlike the nullable column) it is
        // guaranteed set: personal (org-less) documents are never enqueued.
        organizationId,
        candidateId: document.candidateId,
        fileName: document.originalFileName,
        documentType: document.type,
        content,
        mimeType: document.mimeType,
      });

      if (result.vectorsIndexed <= 0) {
        // Nothing was indexed, so the document is not searchable. Reporting
        // COMPLETED here would claim work that did not happen.
        throw new Error(
          `AI service indexed no vectors for document ${documentId}`,
        );
      }

      // Deleted while indexing was in flight? The delete's vector eviction
      // may have run before the vectors above were written — remove them so
      // the deletion stays authoritative.
      const stillExists = await this.prisma.document.findFirst({
        where: { id: documentId, organizationId },
        select: { id: true },
      });
      if (!stillExists) {
        await this.ai.deleteDocument(organizationId, documentId);
        this.logger.log(
          `Document ${documentId} was deleted mid-processing; freshly indexed vectors evicted`,
        );
        return;
      }

      await this.processing.markCompleted(documentId, result.pageCount);
      await job.updateProgress(PROCESSING_PROGRESS.COMPLETED);

      this.logger.log(
        `Document ${documentId} processed: ${result.chunksCreated} chunk(s), ` +
          `${result.vectorsIndexed} vector(s), ${result.pageCount} page(s)`,
      );
    } catch (error) {
      const message =
        error instanceof AiServiceDisabledError || error instanceof Error
          ? error.message
          : 'Unknown processing error';

      await this.processing.markFailed(documentId, message, attempts);
      throw error;
    }
  }
}

/** Re-exported so tests can assert the stage set without importing Prisma. */
export const AI_REPORTED_STAGES = [
  DocumentStatus.PARSING,
  DocumentStatus.CHUNKING,
  DocumentStatus.EMBEDDING,
  DocumentStatus.INDEXING,
] as const;
