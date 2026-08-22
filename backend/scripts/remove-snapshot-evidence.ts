/**
 * ONE-TIME migration cleanup: hard-deletes the application-time evidence
 * SNAPSHOT model's data — the org-scoped Document copies made at apply time,
 * the ApplicationLinkSource rows, their storage objects, their Qdrant vectors
 * in the tenant collection, and the derived AI artifacts (RequirementEvidenceMap
 * + CandidateEvidence) that cite them.
 *
 * Runs BEFORE the `remove_application_evidence_snapshots` schema migration:
 * discovery needs the lineage columns that migration drops. All SQL is raw so
 * this file keeps compiling after the Prisma client no longer knows those
 * columns; run against a post-migration database it reports the model as
 * already removed and exits.
 *
 * ## What is a snapshot (the discrimination predicate)
 *
 * An org-scoped document row is an apply-time copy iff ANY of:
 *   - "applicationId" IS NOT NULL              (modern multi-file snapshots)
 *   - "sourceCandidateDocumentId" IS NOT NULL  (lineage-era snapshots)
 *   - referenced by a DIRECT application's "submittedDocumentId"
 *     (pre-backfill snapshots from before the applicationId column)
 *
 * Everything in application_link_sources is a snapshot by definition — the
 * table exists for nothing else.
 *
 * ## What is deliberately NOT deleted
 *
 *   - personal documents ("candidateAccountId" set, org NULL) and their bytes
 *   - candidate_links rows
 *   - candidate-collection Qdrant vectors
 *   - Application rows (their "submittedDocumentId" FK is ON DELETE SET NULL)
 *   - Candidate rows, vacancies, notifications, chat
 *   - historical manual-upload org documents (no lineage marker, only ever
 *     referenced by hidden MANUAL_UPLOAD associations) and their evidence rows
 *   - requirement_evidence_maps of those hidden manual candidates
 *
 * Applicant-scoped requirement_evidence_maps ARE deleted: their evidence rows
 * cite snapshot sources, so keeping a verdict whose proof is being deleted
 * would show recruiters "EVIDENCE_FOUND" with nothing behind it. JD Evidence
 * regenerates on demand from CURRENT candidate evidence.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/remove-snapshot-evidence.ts --dry-run
 *   ALLOW_SNAPSHOT_CLEANUP=true npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/remove-snapshot-evidence.ts
 */
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiServiceClient } from '../src/ai/ai-service.client';
import { StorageService } from '../src/storage/storage.service';

const logger = new Logger('SnapshotCleanup');

interface SnapshotDocument {
  id: string;
  organizationId: string;
  storageKey: string;
}
interface SnapshotLink {
  id: string;
  organizationId: string;
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const item = items[index];
        index += 1;
        await run(item);
      }
    }),
  );
}

async function main() {
  const dryRun =
    process.argv.includes('--dry-run') ||
    process.env.ALLOW_SNAPSHOT_CLEANUP !== 'true';
  if (process.env.NODE_ENV === 'production') {
    throw new Error('snapshot cleanup refuses to run with NODE_ENV=production');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const ai = app.get(AiServiceClient);
  const storage = app.get(StorageService);

  try {
    // Post-migration idempotence: if the snapshot table is gone, so is the
    // whole model, and there is nothing left for this script to do.
    const [{ exists: tableExists }] = await prisma.$queryRawUnsafe<
      { exists: boolean }[]
    >(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_name = 'application_link_sources') AS exists`,
    );
    if (!tableExists) {
      logger.log('Snapshot model already removed from the schema — nothing to do.');
      return;
    }

    const snapshotDocuments = await prisma.$queryRawUnsafe<SnapshotDocument[]>(
      `SELECT id, "organizationId", "storageKey" FROM documents
        WHERE "organizationId" IS NOT NULL
          AND ("applicationId" IS NOT NULL
            OR "sourceCandidateDocumentId" IS NOT NULL
            OR id IN (SELECT "submittedDocumentId" FROM applications
                       WHERE source = 'DIRECT' AND "submittedDocumentId" IS NOT NULL))`,
    );
    const snapshotLinks = await prisma.$queryRawUnsafe<SnapshotLink[]>(
      `SELECT id, "organizationId" FROM application_link_sources`,
    );
    const retainedOrgDocs = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM documents
        WHERE "organizationId" IS NOT NULL
          AND NOT ("applicationId" IS NOT NULL
            OR "sourceCandidateDocumentId" IS NOT NULL
            OR id IN (SELECT "submittedDocumentId" FROM applications
                       WHERE source = 'DIRECT' AND "submittedDocumentId" IS NOT NULL))`,
    );
    const [{ count: evidenceOnSnapshots }] = await prisma.$queryRawUnsafe<
      { count: bigint }[]
    >(
      `SELECT count(*) AS count FROM candidate_evidence
        WHERE "linkSourceId" IS NOT NULL
           OR "documentId" = ANY($1::text[])`,
      snapshotDocuments.map((d) => d.id),
    );
    const [{ count: applicantMaps }] = await prisma.$queryRawUnsafe<
      { count: bigint }[]
    >(
      `SELECT count(*) AS count FROM requirement_evidence_maps
        WHERE "candidateId" IN
          (SELECT id FROM candidates WHERE "candidateAccountId" IS NOT NULL)`,
    );
    const [personalBefore] = await prisma.$queryRawUnsafe<
      { docs: bigint; links: bigint }[]
    >(
      `SELECT (SELECT count(*) FROM documents WHERE "candidateAccountId" IS NOT NULL) AS docs,
              (SELECT count(*) FROM candidate_links) AS links`,
    );

    logger.log(
      `Snapshot inventory: ${snapshotDocuments.length} document copies, ` +
        `${snapshotLinks.length} link snapshots, ` +
        `${evidenceOnSnapshots} snapshot-citing evidence rows, ` +
        `${applicantMaps} applicant evidence maps; ` +
        `retained non-snapshot org documents: ${retainedOrgDocs[0].count}; ` +
        `personal evidence untouched: ${personalBefore.docs} files, ${personalBefore.links} links`,
    );

    if (dryRun) {
      logger.log(
        '[dry-run] nothing was deleted. Set ALLOW_SNAPSHOT_CLEANUP=true to remove.',
      );
      return;
    }

    // 1 — tenant-collection vectors first, through the product path (the same
    // idempotent /internal/documents/delete used by every eviction). Both file
    // copies and link snapshots share the org collection's documentId key
    // space. Failures are counted, not fatal: a stale vector for a row this
    // script is about to delete is unreachable by every query.
    let vectorFailures = 0;
    await mapLimit(snapshotLinks, 8, async (link) => {
      await ai.deleteDocument(link.organizationId, link.id).catch(() => {
        vectorFailures += 1;
      });
    });
    await mapLimit(snapshotDocuments, 8, async (document) => {
      await ai.deleteDocument(document.organizationId, document.id).catch(() => {
        vectorFailures += 1;
      });
    });

    // 2 — copied bytes.
    let storageFailures = 0;
    await mapLimit(snapshotDocuments, 8, async (document) => {
      await storage.delete(document.storageKey).catch(() => {
        storageFailures += 1;
      });
    });

    // 3 — rows. Deleting the documents cascades their CandidateEvidence
    // citations (FK ON DELETE CASCADE); link-citing evidence and the whole
    // link table go explicitly; applications' submittedDocumentId nulls out
    // (FK ON DELETE SET NULL) leaving every Application row intact.
    await prisma.$executeRawUnsafe(
      `DELETE FROM candidate_evidence WHERE "linkSourceId" IS NOT NULL`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM application_link_sources`);
    const documentIds = snapshotDocuments.map((d) => d.id);
    for (let i = 0; i < documentIds.length; i += 200) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM documents WHERE id = ANY($1::text[])`,
        documentIds.slice(i, i + 200),
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM requirement_evidence_maps
        WHERE "candidateId" IN
          (SELECT id FROM candidates WHERE "candidateAccountId" IS NOT NULL)`,
    );
    // Snapshot-only processing bookkeeping: jobs for documents that no longer
    // exist have nothing to report on (FK on ProcessingJob.documentId cascades
    // with the document row — nothing to do here if the schema cascades).

    // 4 — verify the delta, exactly.
    const [after] = await prisma.$queryRawUnsafe<
      {
        snapshot_docs: bigint;
        link_rows: bigint;
        applicant_maps: bigint;
        personal_docs: bigint;
        personal_links: bigint;
        applications: bigint;
      }[]
    >(
      `SELECT
        (SELECT count(*) FROM documents
          WHERE "applicationId" IS NOT NULL OR "sourceCandidateDocumentId" IS NOT NULL) AS snapshot_docs,
        (SELECT count(*) FROM application_link_sources) AS link_rows,
        (SELECT count(*) FROM requirement_evidence_maps
          WHERE "candidateId" IN (SELECT id FROM candidates WHERE "candidateAccountId" IS NOT NULL)) AS applicant_maps,
        (SELECT count(*) FROM documents WHERE "candidateAccountId" IS NOT NULL) AS personal_docs,
        (SELECT count(*) FROM candidate_links) AS personal_links,
        (SELECT count(*) FROM applications) AS applications`,
    );
    logger.log(
      `After cleanup: snapshot docs ${after.snapshot_docs}, link rows ${after.link_rows}, ` +
        `applicant maps ${after.applicant_maps} (all must be 0); ` +
        `personal files ${after.personal_docs} (was ${personalBefore.docs}), ` +
        `personal links ${after.personal_links} (was ${personalBefore.links}), ` +
        `applications ${after.applications} — preserved. ` +
        `Vector eviction failures: ${vectorFailures}; storage failures: ${storageFailures}`,
    );
    if (
      after.snapshot_docs !== 0n ||
      after.link_rows !== 0n ||
      after.applicant_maps !== 0n ||
      after.personal_docs !== personalBefore.docs ||
      after.personal_links !== personalBefore.links
    ) {
      throw new Error('Post-cleanup verification failed — inspect before migrating');
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
