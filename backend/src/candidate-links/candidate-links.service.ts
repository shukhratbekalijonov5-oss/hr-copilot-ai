import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai/ai-service.client';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';
import { CandidateEvidenceLifecycleService } from '../candidate-evidence/candidate-evidence.service';
import { WebIngestionError } from '../web-ingestion/web-ingestion.errors';
import { hostnameOf, parseCandidateUrl } from '../web-ingestion/url-policy';
import { LinkFailureCode, LinkStatus } from '../generated/prisma/enums';
import {
  LINK_ERROR_CODES,
  MAX_CANDIDATE_LINKS,
  linkAlreadyExists,
  linkLimitReached,
} from './link-policy';
import { Prisma } from '../generated/prisma/client';
import type { UpsertCandidateLinkDto } from './dto/upsert-candidate-link.dto';

/**
 * The candidate's own professional links — and only ever their own.
 *
 * Structurally identical to how personal documents are handled, deliberately:
 * every method takes the authenticated userId, resolves the account through
 * it, and scopes the link lookup by that account id. No method accepts a
 * foreign account id, so one candidate probing another's link id gets a 404
 * indistinguishable from a link that never existed.
 *
 * These links are PERSONAL evidence. They are indexed only into the
 * candidate-scoped Qdrant collection, carry no organizationId anywhere, and
 * are reachable by exactly one AI feature: the candidate's own Job Match. An
 * organization only ever sees ApplicationLinkSource — the frozen copy taken at
 * apply time — and there is no recruiter endpoint that writes here at all.
 */
@Injectable()
export class CandidateLinksService {
  private readonly logger = new Logger(CandidateLinksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: DocumentProcessingProducer,
    private readonly ai: AiServiceClient,
    private readonly evidence: CandidateEvidenceLifecycleService,
  ) {}

  async list(userId: string) {
    const accountId = await this.requireAccountId(userId);
    const links = await this.prisma.candidateLink.findMany({
      where: { candidateAccountId: accountId },
      orderBy: { createdAt: 'asc' },
      select: LINK_SELECT,
    });
    return {
      data: links.map(toLinkResponse),
      limit: MAX_CANDIDATE_LINKS,
      remaining: Math.max(0, MAX_CANDIDATE_LINKS - links.length),
    };
  }

  /**
   * Adds one link and queues it for fetching.
   *
   * The limit is enforced INSIDE a transaction that first row-locks the
   * candidate account, exactly as personal uploads do: two concurrent requests
   * cannot both pass the count check, so an account can never end up with four
   * links. The unique index on (candidateAccountId, normalizedUrl) is the
   * second guard, catching a duplicate that slips through a race.
   */
  async create(userId: string, dto: UpsertCandidateLinkDto) {
    const accountId = await this.requireAccountId(userId);
    const target = this.parseUrl(dto.url);

    const link = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM candidate_accounts WHERE id = ${accountId} FOR UPDATE`;
        const existing = await tx.candidateLink.count({
          where: { candidateAccountId: accountId },
        });
        if (existing >= MAX_CANDIDATE_LINKS) throw linkLimitReached();

        return tx.candidateLink.create({
          data: {
            candidateAccountId: accountId,
            url: target.href,
            normalizedUrl: target.normalized,
            title: dto.title?.trim() || null,
            detectedType: target.detectedType,
            status: LinkStatus.PENDING,
          },
          select: LINK_SELECT,
        });
      })
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002') {
          throw linkAlreadyExists();
        }
        throw error;
      });

    // A new source changes what the AI can see, so anything generated before
    // it is no longer a description of the current evidence.
    await this.evidence.bumpRevision(accountId);
    await this.enqueue(link.id, accountId);
    return toLinkResponse(link);
  }

  /**
   * Replaces a link's URL and/or label.
   *
   * A changed URL is a DIFFERENT SOURCE, so it is treated as one: the old
   * source's vectors are evicted, the extracted content and failure state are
   * cleared, and the row goes back to PENDING for a fresh fetch. Silently
   * keeping the old content under a new URL would make every citation a lie.
   *
   * The organization copies of the OLD address go too. Re-pointing a link is
   * the candidate saying "that is not my evidence any more", and leaving a
   * recruiter reading a snapshot of an address its owner has disowned is the
   * same failure as leaving a deleted one there.
   */
  async update(userId: string, linkId: string, dto: UpsertCandidateLinkDto) {
    const accountId = await this.requireAccountId(userId);
    const link = await this.requireOwnLink(accountId, linkId);
    const target = this.parseUrl(dto.url);

    const urlChanged = target.normalized !== link.normalizedUrl;
    if (!urlChanged) {
      const renamed = await this.prisma.candidateLink.update({
        where: { id: link.id },
        data: { title: dto.title?.trim() || null },
        select: LINK_SELECT,
      });
      return toLinkResponse(renamed);
    }

    const updated = await this.prisma.candidateLink
      .update({
        where: { id: link.id },
        data: {
          url: target.href,
          normalizedUrl: target.normalized,
          title: dto.title?.trim() || null,
          detectedType: target.detectedType,
          status: LinkStatus.PENDING,
          failureCode: null,
          failureMessage: null,
          sections: Prisma.DbNull,
          contentHash: null,
          charCount: null,
          pagesFetched: null,
          fetchMode: null,
          lastFetchedAt: null,
        },
        select: LINK_SELECT,
      })
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002') {
          throw linkAlreadyExists();
        }
        throw error;
      });

    // The row keeps its id, so the new fetch would upsert on top of the old
    // source's chunks; evicting first means a shorter new page cannot leave
    // the previous page's text behind.
    await this.evictPersonalVectors(link.id, accountId);
    // ...and the submitted copies of the address being replaced.
    await this.evidence.cascadeDerivedCopyRemoval(accountId, {
      linkId: link.id,
    });
    await this.enqueue(link.id, accountId, { replaceExisting: true });
    return toLinkResponse(updated);
  }

  /**
   * Deletes one of the caller's own links — everywhere.
   *
   * The candidate owns this evidence, so removing it removes it: the row, the
   * personal vectors, every `ApplicationLinkSource` snapshot copied from it in
   * every organization it was submitted to, those snapshots' vectors, the
   * citations built on them, and the requirement mappings those citations were
   * the proof for.
   *
   * The APPLICATIONS survive untouched — status, chat, notifications, history.
   * An application whose evidence has been withdrawn is an application with no
   * current evidence, and a recruiter sees exactly that rather than a verdict
   * whose proof quietly disappeared.
   *
   * Deleting a link that is still PENDING or FETCHING is allowed and safe: the
   * worker re-reads the row before it commits anything, finds it gone, and
   * evicts instead of completing (see DocumentProcessingProcessor), so a job
   * in flight cannot resurrect the source.
   */
  async remove(userId: string, linkId: string) {
    const accountId = await this.requireAccountId(userId);
    const link = await this.requireOwnLink(accountId, linkId);

    await this.evidence.cascadePersonalLinkDeletion(accountId, link.id);

    return { id: link.id, deleted: true };
  }

  /**
   * Re-fetches a link: the candidate's "Retry" after a failure and their
   * "Refresh" after the page changed.
   *
   * Permanent failures are refused rather than silently re-queued — retrying a
   * private-network target or an unsupported protocol can only fail the same
   * way, and pretending otherwise trains people to keep pressing a button that
   * cannot work.
   */
  async reprocess(userId: string, linkId: string) {
    const accountId = await this.requireAccountId(userId);
    const link = await this.requireOwnLink(accountId, linkId);

    if (
      link.status === LinkStatus.FAILED &&
      link.failureCode &&
      PERMANENT_FAILURES.has(link.failureCode)
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'This link cannot be retried; edit or remove it instead.',
        code: LINK_ERROR_CODES.LINK_NOT_RETRYABLE,
      });
    }
    if (
      IN_FLIGHT_STATUSES.has(link.status) &&
      (await this.producer.hasLiveLinkJob(link.id))
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'This link is already being processed.',
        code: LINK_ERROR_CODES.LINK_BUSY,
      });
    }

    const updated = await this.prisma.candidateLink.update({
      where: { id: link.id },
      data: {
        status: LinkStatus.PENDING,
        failureCode: null,
        failureMessage: null,
      },
      select: LINK_SELECT,
    });
    await this.enqueue(link.id, accountId, { replaceExisting: true });
    return toLinkResponse(updated);
  }

  /**
   * The COMPLETED links an apply may snapshot.
   *
   * Only COMPLETED: a pending, failed or in-flight link has no verified
   * content, and freezing "whatever we have" into an organization's evidence
   * would submit something neither the candidate nor the recruiter can trust.
   * Shared with the apply flow, which is the only other caller.
   */
  async listSubmittableLinks(candidateAccountId: string) {
    return this.prisma.candidateLink.findMany({
      where: {
        candidateAccountId,
        status: LinkStatus.COMPLETED,
        // Belt and braces: COMPLETED without content would be a bug, and the
        // apply path must not be the place it first shows up.
        sections: { not: Prisma.DbNull },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_CANDIDATE_LINKS,
    });
  }

  private parseUrl(url: string) {
    try {
      return parseCandidateUrl(url);
    } catch (error) {
      if (error instanceof WebIngestionError) {
        // 400 with a stable code so the UI can localize "This link cannot be
        // used", plus the specific failureCode so a private-network or
        // unsupported-protocol rejection can say why — without echoing the URL.
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: error.detail,
          code: LINK_ERROR_CODES.LINK_INVALID_URL,
          failureCode: error.code,
        });
      }
      throw error;
    }
  }

  private async requireAccountId(userId: string): Promise<string> {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException('Candidate account not found');
    return account.id;
  }

  /** Own links only: a foreign or invented id is an indistinguishable 404. */
  private async requireOwnLink(accountId: string, linkId: string) {
    const link = await this.prisma.candidateLink.findFirst({
      where: { id: linkId, candidateAccountId: accountId },
    });
    if (!link) throw new NotFoundException('Link not found');
    return link;
  }

  private async enqueue(
    linkId: string,
    candidateAccountId: string,
    options: { replaceExisting?: boolean } = {},
  ): Promise<void> {
    try {
      await this.producer.enqueueCandidateLink(
        { linkId, candidateAccountId },
        options,
      );
    } catch (error) {
      // Redis being down must not lose the link: the row is durable and stays
      // PENDING, and the candidate can retry.
      this.logger.error(
        `Enqueue failed for candidate link ${linkId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Removes a personal link's chunks. Queued (BullMQ retries with backoff),
   * with an inline fallback when Redis is unavailable — the same two-step the
   * personal-document delete uses, because stale vectors for a deleted source
   * would keep surfacing in the candidate's own Job Match.
   */
  private async evictPersonalVectors(
    linkId: string,
    candidateAccountId: string,
  ): Promise<void> {
    try {
      await this.producer.enqueueCandidateLinkIndexDeletion({
        linkId,
        candidateAccountId,
      });
    } catch (queueError) {
      this.logger.warn(
        `Eviction enqueue failed for link ${linkId}; evicting inline: ${(queueError as Error).message}`,
      );
      try {
        await this.ai.deletePersonalWebSource(candidateAccountId, linkId);
      } catch (aiError) {
        this.logger.error(
          `Link ${linkId} removed but its vectors could not be evicted: ${(aiError as Error).message}`,
        );
      }
    }
  }
}

/** Statuses meaning "a worker already has this link". */
const IN_FLIGHT_STATUSES = new Set<LinkStatus>([
  LinkStatus.PENDING,
  LinkStatus.FETCHING,
  LinkStatus.PROCESSING,
]);

/**
 * Failures that retrying cannot fix. Mirrors linkFailureIsRetryable, from the
 * other direction — this is the user-facing gate, that one is the worker's.
 */
const PERMANENT_FAILURES = new Set<LinkFailureCode>([
  LinkFailureCode.INVALID_URL,
  LinkFailureCode.UNSUPPORTED_PROTOCOL,
  LinkFailureCode.PRIVATE_NETWORK_URL,
  LinkFailureCode.UNSUPPORTED_CONTENT_TYPE,
  LinkFailureCode.ACCESS_DENIED,
  LinkFailureCode.NO_MEANINGFUL_CONTENT,
  LinkFailureCode.CONTENT_TOO_LARGE,
  LinkFailureCode.TOO_MANY_REDIRECTS,
]);

/**
 * What a candidate may see of their own link. `sections` and `normalizedUrl`
 * are deliberately excluded: the extracted text is an internal representation
 * (the page itself is one click away) and the normalized form is a storage
 * detail nobody needs.
 */
const LINK_SELECT = {
  id: true,
  url: true,
  title: true,
  detectedType: true,
  status: true,
  failureCode: true,
  charCount: true,
  pagesFetched: true,
  lastFetchedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type LinkRow = Prisma.CandidateLinkGetPayload<{ select: typeof LINK_SELECT }>;

function toLinkResponse(link: LinkRow) {
  return {
    id: link.id,
    url: link.url,
    // Falls back to the hostname so a link is never rendered as an empty row
    // while it is still being fetched.
    title: link.title ?? hostnameOf(link.url),
    detectedType: link.detectedType,
    status: link.status,
    failureCode: link.failureCode,
    charCount: link.charCount,
    pagesFetched: link.pagesFetched,
    lastFetchedAt: link.lastFetchedAt,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}
