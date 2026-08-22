import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../ai/ai-service.client';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';

/**
 * The single owner of what happens when a candidate's evidence set changes.
 *
 * ## The product rule this enforces
 *
 * A candidate owns their evidence, and there is exactly ONE copy of it — the
 * current one, under their account. Nothing snapshots it at apply time any
 * more. When they delete a file or a professional link, that evidence stops
 * existing everywhere in HR Copilot — their own AI, every recruiter surface
 * of every organization they applied to, and every stored citation — while
 * the APPLICATION itself survives with its status, its chat and its history
 * intact. An application whose evidence has all been deleted is an
 * application with no current evidence, not a deleted application.
 *
 * ## The order, and why
 *
 *  1. **Storage bytes for the personal file first** (the caller's job). If
 *     that fails the whole delete aborts with nothing else changed — success
 *     is never reported while the private bytes provably remain.
 *  2. **One transaction flips the authoritative state**: the personal row
 *     (whose FK cascades take every stored CandidateEvidence citation with
 *     it, in every organization), the derived RequirementEvidenceMap verdicts,
 *     and the evidence revision all move together. Everything that decides
 *     what the AI may read is read from these rows, so the privacy rule takes
 *     effect at commit, not when the last vector is finally evicted.
 *  3. **Vectors afterwards, best effort and idempotent.** A Qdrant outage
 *     delays physical cleanup; it does not delay the rule, because retrieval
 *     is authorized against step 2's rows (see `activePersonalSourceIds`).
 *     A stale vector is inert, and re-running the delete converges.
 */
@Injectable()
export class CandidateEvidenceLifecycleService {
  private readonly logger = new Logger(CandidateEvidenceLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
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
   * Invalidates the AI artifacts DERIVED from one personal source, inside the
   * caller's transaction.
   *
   * The stored `CandidateEvidence` citations of a deleted row are handled by
   * their foreign keys (ON DELETE CASCADE from `documents` / `candidate_links`)
   * — this helper exists for what a foreign key could never do. A
   * `RequirementEvidenceMap` row that said "Kubernetes — EVIDENCE_FOUND"
   * would survive with nothing behind it, and a recruiter would read a
   * verdict whose proof had silently vanished. So the mapping rows for every
   * org-side record of this account go too, in every organization, and JD
   * Evidence reports the requirement as un-run until someone re-runs it
   * against what remains. Compare reads those same rows, so it is invalidated
   * by the same deletion. Summary, Ask and Interview Questions are generated
   * per request and cached nowhere — they simply cannot retrieve a source
   * that no longer exists.
   *
   * `citationsOf` covers the one case with no cascade: a link RE-POINTED at a
   * different URL keeps its row, so its stored citations must go explicitly —
   * the passages cited came from an address the candidate no longer claims.
   */
  private async invalidateDerivedArtifacts(
    tx: PrismaTransaction,
    candidateAccountId: string,
    citationsOf?: { linkId: string },
  ): Promise<void> {
    if (citationsOf) {
      await tx.candidateEvidence.deleteMany({
        where: { candidateLinkId: citationsOf.linkId },
      });
    }
    await tx.requirementEvidenceMap.deleteMany({
      where: { candidate: { candidateAccountId } },
    });
  }

  /**
   * FULL cascade for one personal FILE.
   *
   * Assumes the caller has already verified ownership and removed the personal
   * object bytes — that ordering is the caller's privacy guarantee and is not
   * duplicated here. Deleting the row cascades every stored citation of it
   * (in every organization) at the database level; the derived verdicts are
   * invalidated explicitly.
   */
  async cascadePersonalFileDeletion(
    candidateAccountId: string,
    documentId: string,
    options: { repointResumeTo?: 'newest' } = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.document.deleteMany({
        where: { id: documentId, candidateAccountId },
      });
      await this.invalidateDerivedArtifacts(tx, candidateAccountId);

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
    });

    await this.evictPersonalFileVectors(candidateAccountId, documentId);

    this.logger.log(
      `Personal file ${documentId} deleted; its citations and derived ` +
        `verdicts are gone from every organization`,
    );
  }

  /** FULL cascade for one personal LINK. */
  async cascadePersonalLinkDeletion(
    candidateAccountId: string,
    linkId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.candidateLink.deleteMany({
        where: { id: linkId, candidateAccountId },
      });
      await this.invalidateDerivedArtifacts(tx, candidateAccountId);
      await tx.candidateAccount.update({
        where: { id: candidateAccountId },
        data: { evidenceRevision: { increment: 1 } },
      });
    });

    await this.evictPersonalLinkVectors(candidateAccountId, linkId);

    this.logger.log(`Personal link ${linkId} deleted with its derived artifacts`);
  }

  /**
   * Invalidation WITHOUT deleting the personal source itself.
   *
   * Used when a link is re-pointed at a different URL. That is a different
   * source wearing the same row id: stored citations of the OLD address are
   * removed explicitly (the row survives, so no FK fires), the derived
   * verdicts are reset, and whatever the new URL yields becomes the only
   * current version once it is re-fetched and re-indexed.
   */
  async cascadeDerivedCopyRemoval(
    candidateAccountId: string,
    source: { fileId?: string; linkId?: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.invalidateDerivedArtifacts(
        tx,
        candidateAccountId,
        source.linkId ? { linkId: source.linkId } : undefined,
      );
      await tx.candidateAccount.update({
        where: { id: candidateAccountId },
        data: { evidenceRevision: { increment: 1 } },
      });
    });
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

/**
 * The transaction-scoped client. Typed structurally rather than with
 * `Prisma.TransactionClient` so the helpers stay readable and testable.
 */
type PrismaTransaction = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];
