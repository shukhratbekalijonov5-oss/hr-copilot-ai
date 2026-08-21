import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AiServiceClient } from '../ai/ai-service.client';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';

/**
 * The single owner of what happens when a candidate's evidence set changes.
 *
 * ## The product rule this enforces
 *
 * A candidate owns their evidence. When they delete a file or a professional
 * link, that evidence stops existing everywhere in HR Copilot — their own AI,
 * every organization they sent it to, every recruiter AI surface and every
 * citation — while the APPLICATION itself survives with its status, its chat
 * and its history intact. An application whose evidence has all been deleted is
 * an application with no current evidence, not a deleted application.
 *
 * This replaces the previous rule, under which an organization's snapshot was
 * preserved forever. Snapshots are still immutable in the sense that matters —
 * nothing rewrites their content, and a live page changing does not change what
 * was submitted — but they no longer outlive the source they were copied from.
 *
 * ## Why one service
 *
 * The cascade touches five systems that have no shared transaction: Postgres
 * rows, object storage, the personal Qdrant collection, one organization
 * collection per recipient, and the derived AI artifacts stored in Postgres.
 * Spreading that across the delete paths guarantees they drift. Here it is one
 * ordered, idempotent sequence, described once.
 *
 * ## The order, and why
 *
 *  1. **Storage bytes for the personal file first.** If this fails the whole
 *     delete aborts with nothing else changed — success is never reported while
 *     the private bytes provably remain.
 *  2. **One transaction flips the authoritative state**: the personal row, the
 *     derived organization copies, the derived AI artifacts and the evidence
 *     revision all move together. Everything that decides what the AI may read
 *     is read from these rows, so the privacy rule takes effect at commit,
 *     not when the last vector is finally evicted.
 *  3. **Vectors and organization bytes afterwards, best effort and
 *     idempotent.** A Qdrant outage delays physical cleanup; it does not delay
 *     the rule, because retrieval is authorized against step 2's rows (see
 *     `activeApplicationSourceIds` / `activePersonalSourceIds`). A stale vector
 *     is inert, and re-running the delete converges.
 */
@Injectable()
export class CandidateEvidenceLifecycleService {
  private readonly logger = new Logger(CandidateEvidenceLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly producer: DocumentProcessingProducer,
    private readonly ai: AiServiceClient,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Reads — "what evidence exists RIGHT NOW"                                */
  /* ---------------------------------------------------------------------- */

  /**
   * How much evidence the account currently holds, by kind.
   *
   * Both halves count independently, exactly as the limits do. This is what
   * the zero-evidence gate is decided on: a candidate with no files and no
   * links has nothing for an evidence-grounded feature to be grounded in.
   */
  async activeSourceCounts(
    candidateAccountId: string,
  ): Promise<{ files: number; links: number; total: number }> {
    const [files, links] = await Promise.all([
      this.prisma.document.count({
        where: { candidateAccountId, organizationId: null },
      }),
      this.prisma.candidateLink.count({ where: { candidateAccountId } }),
    ]);
    return { files, links, total: files + links };
  }

  /**
   * Every source id the candidate's OWN AI is currently allowed to read.
   *
   * Files and links share one key space in the index (a chunk's `documentId`
   * is its source id whichever kind it is), so this is one flat list and the
   * AI service needs no per-kind logic.
   *
   * This is the defence that does not depend on cleanup having succeeded: the
   * personal collection may still physically hold a deleted source's vectors
   * for as long as an eviction is retrying, and passing this list means those
   * vectors cannot be returned meanwhile.
   */
  async activePersonalSourceIds(candidateAccountId: string): Promise<string[]> {
    const [documents, links] = await Promise.all([
      this.prisma.document.findMany({
        where: { candidateAccountId, organizationId: null },
        select: { id: true },
      }),
      this.prisma.candidateLink.findMany({
        where: { candidateAccountId },
        select: { id: true },
      }),
    ]);
    return [...documents.map((d) => d.id), ...links.map((l) => l.id)];
  }

  /**
   * Every source id ONE organization may currently read for one candidate —
   * the surviving submitted files and link snapshots.
   *
   * Deliberately organization-scoped as well as candidate-scoped: the list is
   * a retrieval filter, and a filter that leaked ids across tenants would be
   * worse than no filter at all.
   */
  async activeApplicationSourceIds(
    organizationId: string,
    candidateId: string,
  ): Promise<string[]> {
    const [documents, linkSources] = await Promise.all([
      this.prisma.document.findMany({
        where: { organizationId, candidateId },
        select: { id: true },
      }),
      this.prisma.applicationLinkSource.findMany({
        where: { organizationId, candidateId },
        select: { id: true },
      }),
    ]);
    return [...documents.map((d) => d.id), ...linkSources.map((s) => s.id)];
  }

  /** The account's current evidence revision. */
  async revision(candidateAccountId: string): Promise<number> {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { id: candidateAccountId },
      select: { evidenceRevision: true },
    });
    return account?.evidenceRevision ?? 0;
  }

  /* ---------------------------------------------------------------------- */
  /* Writes                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Records that the account's evidence set changed.
   *
   * Called for every meaningful change — added, deleted, re-pointed, or
   * re-fetched with different content — and never for a profile edit, because
   * a new headline does not invalidate an analysis of someone's documents.
   *
   * Failure is logged rather than thrown: a missed bump makes a stale result
   * look current for one cycle, while throwing would fail an evidence change
   * that has already happened.
   */
  async bumpRevision(candidateAccountId: string): Promise<void> {
    try {
      await this.prisma.candidateAccount.update({
        where: { id: candidateAccountId },
        data: { evidenceRevision: { increment: 1 } },
      });
    } catch (error) {
      this.logger.error(
        `Could not bump evidence revision for account ${candidateAccountId}: ` +
          `${(error as Error).message}`,
      );
    }
  }

  /**
   * Removes every ORGANIZATION-side copy derived from one personal source, in
   * every organization it was ever submitted to.
   *
   * Returns the ids that were removed so the caller can evict their vectors
   * after the transaction commits.
   *
   * Lineage is what makes this exact rather than approximate: only copies
   * whose `sourceCandidateDocumentId` / `sourceLinkId` names THIS source are
   * touched. Another file the same person submitted to the same application is
   * not related to this one and is left alone.
   */
  private async collectDerivedCopies(
    tx: PrismaTransaction,
    source: { fileId?: string; linkId?: string },
  ): Promise<DerivedCopies> {
    const documents = source.fileId
      ? await tx.document.findMany({
          where: {
            sourceCandidateDocumentId: source.fileId,
            organizationId: { not: null },
          },
          select: {
            id: true,
            organizationId: true,
            candidateId: true,
            storageKey: true,
          },
        })
      : [];
    const linkSources = source.linkId
      ? await tx.applicationLinkSource.findMany({
          where: { sourceLinkId: source.linkId },
          select: { id: true, organizationId: true, candidateId: true },
        })
      : [];

    return {
      documents: documents.map((d) => ({
        id: d.id,
        organizationId: d.organizationId!,
        candidateId: d.candidateId,
        storageKey: d.storageKey,
      })),
      linkSources,
    };
  }

  /**
   * Deletes the derived copies inside the caller's transaction and invalidates
   * the AI artifacts derived FROM them.
   *
   * The invalidation is the part a foreign key could never do. Deleting a
   * `Document` cascades its `CandidateEvidence` citations away, which is
   * correct but not sufficient: the `RequirementEvidenceMap` row that said
   * "Kubernetes — EVIDENCE_FOUND" would survive with nothing behind it, and a
   * recruiter would read a verdict whose proof had silently vanished. So the
   * mapping rows for every affected candidate go too, and JD Evidence reports
   * the requirement as un-run until someone re-runs it against what remains.
   *
   * Compare reads those same rows, so it is invalidated by the same deletion.
   * Summary, Ask and Interview Questions are generated per request and cached
   * nowhere, so there is nothing of theirs to invalidate — they simply cannot
   * retrieve a source that no longer exists.
   */
  private async removeDerivedCopies(
    tx: PrismaTransaction,
    derived: DerivedCopies,
  ): Promise<void> {
    if (derived.documents.length > 0) {
      await tx.document.deleteMany({
        where: { id: { in: derived.documents.map((d) => d.id) } },
      });
    }
    if (derived.linkSources.length > 0) {
      await tx.applicationLinkSource.deleteMany({
        where: { id: { in: derived.linkSources.map((s) => s.id) } },
      });
    }

    const affectedCandidateIds = [
      ...new Set([
        ...derived.documents.map((d) => d.candidateId),
        ...derived.linkSources.map((s) => s.candidateId),
      ]),
    ].filter((id): id is string => Boolean(id));

    if (affectedCandidateIds.length > 0) {
      // Scoped to the candidates whose evidence actually changed — an
      // unrelated organization's mapping work is not thrown away.
      await tx.requirementEvidenceMap.deleteMany({
        where: { candidateId: { in: affectedCandidateIds } },
      });
    }
  }

  /**
   * Physical cleanup after the transaction: organization vectors, organization
   * bytes, and the personal vectors.
   *
   * Every step is best effort and idempotent. Nothing here is allowed to throw
   * — the authoritative deletion already happened, and turning a storage
   * hiccup into a failed request would tell the candidate their file was not
   * deleted when it was.
   */
  private async evictDerived(derived: DerivedCopies): Promise<void> {
    for (const document of derived.documents) {
      await this.storage.delete(document.storageKey).catch(() => {
        this.logger.warn(
          `Submitted copy ${document.id} removed but its stored object remains`,
        );
      });
      await this.deleteOrgVectors(document.organizationId, document.id);
    }
    for (const source of derived.linkSources) {
      await this.deleteOrgVectors(source.organizationId, source.id);
    }
  }

  private async deleteOrgVectors(
    organizationId: string,
    sourceId: string,
  ): Promise<void> {
    if (!this.ai.enabled) return;
    try {
      await this.ai.deleteDocument(organizationId, sourceId);
    } catch (error) {
      // Retrieval is authorized against the rows, which are already gone, so
      // a surviving vector is unreachable rather than dangerous.
      this.logger.error(
        `Source ${sourceId} deleted but its organization vectors could not be ` +
          `evicted: ${(error as Error).message}`,
      );
    }
  }

  /**
   * FULL cascade for one personal FILE.
   *
   * Assumes the caller has already verified ownership and removed the personal
   * object bytes — that ordering is the caller's privacy guarantee and is not
   * duplicated here.
   */
  async cascadePersonalFileDeletion(
    candidateAccountId: string,
    documentId: string,
    options: { repointResumeTo?: 'newest' } = {},
  ): Promise<void> {
    const derived = await this.prisma.$transaction(async (tx) => {
      const copies = await this.collectDerivedCopies(tx, {
        fileId: documentId,
      });

      await tx.document.deleteMany({
        where: { id: documentId, candidateAccountId },
      });
      await this.removeDerivedCopies(tx, copies);

      if (options.repointResumeTo === 'newest') {
        const newest = await tx.document.findFirst({
          where: { candidateAccountId, organizationId: null },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        await tx.candidateAccount.update({
          where: { id: candidateAccountId },
          data: { resumeDocumentId: newest?.id ?? null },
        });
      }

      await tx.candidateAccount.update({
        where: { id: candidateAccountId },
        data: { evidenceRevision: { increment: 1 } },
      });

      return copies;
    });

    await this.evictDerived(derived);
    await this.evictPersonalFileVectors(candidateAccountId, documentId);

    this.logger.log(
      `Personal file ${documentId} deleted: ${derived.documents.length} ` +
        `submitted copy/copies removed from ${
          new Set(derived.documents.map((d) => d.organizationId)).size
        } organization(s)`,
    );
  }

  /** FULL cascade for one personal LINK. */
  async cascadePersonalLinkDeletion(
    candidateAccountId: string,
    linkId: string,
  ): Promise<void> {
    const derived = await this.prisma.$transaction(async (tx) => {
      const copies = await this.collectDerivedCopies(tx, { linkId });

      await tx.candidateLink.deleteMany({
        where: { id: linkId, candidateAccountId },
      });
      await this.removeDerivedCopies(tx, copies);
      await tx.candidateAccount.update({
        where: { id: candidateAccountId },
        data: { evidenceRevision: { increment: 1 } },
      });

      return copies;
    });

    await this.evictDerived(derived);
    await this.evictPersonalLinkVectors(candidateAccountId, linkId);

    this.logger.log(
      `Personal link ${linkId} deleted: ${derived.linkSources.length} ` +
        `submitted snapshot(s) removed`,
    );
  }

  /**
   * Removes the organization copies derived from a personal source WITHOUT
   * deleting the personal source itself.
   *
   * Used when a link is re-pointed at a different URL. That is a different
   * source wearing the same row id: the content a recruiter reviewed came from
   * an address the candidate no longer claims, so the submitted copies of the
   * OLD address go, exactly as they would on a delete. What is submitted next
   * is whatever the candidate applies with afterwards.
   */
  async cascadeDerivedCopyRemoval(
    candidateAccountId: string,
    source: { fileId?: string; linkId?: string },
  ): Promise<void> {
    const derived = await this.prisma.$transaction(async (tx) => {
      const copies = await this.collectDerivedCopies(tx, source);
      await this.removeDerivedCopies(tx, copies);
      await tx.candidateAccount.update({
        where: { id: candidateAccountId },
        data: { evidenceRevision: { increment: 1 } },
      });
      return copies;
    });

    await this.evictDerived(derived);
  }

  /**
   * Personal-collection eviction: queued, with an inline fallback when Redis
   * is unavailable. Mirrors the personal-document path because the failure
   * mode is identical — stale vectors for a source the candidate believes is
   * gone.
   */
  private async evictPersonalFileVectors(
    candidateAccountId: string,
    documentId: string,
  ): Promise<void> {
    try {
      await this.producer.enqueuePersonalResumeIndexDeletion({
        documentId,
        candidateAccountId,
      });
    } catch (queueError) {
      this.logger.warn(
        `Eviction enqueue failed for personal file ${documentId}; ` +
          `evicting inline: ${(queueError as Error).message}`,
      );
      if (!this.ai.enabled) return;
      await this.ai
        .deletePersonalResume(candidateAccountId, documentId)
        .catch((error: unknown) => {
          this.logger.error(
            `Personal file ${documentId} deleted but its vectors could not ` +
              `be evicted: ${(error as Error).message}`,
          );
        });
    }
  }

  private async evictPersonalLinkVectors(
    candidateAccountId: string,
    linkId: string,
  ): Promise<void> {
    try {
      await this.producer.enqueueCandidateLinkIndexDeletion({
        linkId,
        candidateAccountId,
      });
    } catch (queueError) {
      this.logger.warn(
        `Eviction enqueue failed for personal link ${linkId}; evicting ` +
          `inline: ${(queueError as Error).message}`,
      );
      if (!this.ai.enabled) return;
      await this.ai
        .deletePersonalWebSource(candidateAccountId, linkId)
        .catch((error: unknown) => {
          this.logger.error(
            `Personal link ${linkId} deleted but its vectors could not be ` +
              `evicted: ${(error as Error).message}`,
          );
        });
    }
  }
}

/** One personal source's organization-side descendants. */
interface DerivedCopies {
  documents: {
    id: string;
    organizationId: string;
    candidateId: string | null;
    storageKey: string;
  }[];
  linkSources: {
    id: string;
    organizationId: string;
    candidateId: string;
  }[];
}

/**
 * The transaction-scoped client. Typed structurally rather than with
 * `Prisma.TransactionClient` so the helpers stay readable and testable.
 */
type PrismaTransaction = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];
