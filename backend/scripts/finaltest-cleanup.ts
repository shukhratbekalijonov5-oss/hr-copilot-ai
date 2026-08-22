/**
 * Removes ONLY the final-test applicant batch created by finaltest-seed.ts.
 *
 * DEVELOPMENT ONLY, and deliberately narrow: the single source of truth for
 * "is this row mine to delete" is the batch email pattern
 *
 *     finaltest.(frontend|backend).NNN@example.test
 *
 * which is matched with a full-string regex, never a `LIKE '%@example.test'`.
 * That distinction is the whole safety story:
 *
 *   - the ~200-user development dataset uses `<role><NNN>@example.test`
 *     (candidate001@, owner001@, …) and does NOT match here;
 *   - hand-made dev accounts (jasur.toshmatov@example.test,
 *     candidate-auth-test@example.test) do NOT match here;
 *   - conversely this batch does not match THEIR marker, so
 *     `npm run seed:synthetic:reset` cannot delete these people either.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/finaltest-cleanup.ts --dry-run
 *   ALLOW_FINALTEST_CLEANUP=true npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/finaltest-cleanup.ts
 *
 * `--dry-run` (the default posture — the destructive path needs the env flag)
 * prints exactly what would be removed and touches nothing.
 *
 * ## What deleting a user removes
 *
 * Deleting the User row cascades in the schema to CandidateAccount, and from
 * there to personal Documents and CandidateLinks. The org-side Candidate rows
 * and their Applications are removed explicitly first, because
 * `Candidate.candidateAccountId` is `onDelete: SetNull` — without this step a
 * cleanup would leave orphaned applicant rows that still count toward a
 * vacancy's candidate total.
 *
 * Vectors are evicted through the AI service BEFORE the rows go, so no
 * candidate-scoped or org-scoped chunks are left behind pointing at people who
 * no longer exist.
 */
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiServiceClient } from '../src/ai/ai-service.client';
import { StorageService } from '../src/storage/storage.service';
import { isFinalTestEmail } from './finaltest-seed.data';

const logger = new Logger('FinalTestCleanup');

async function main() {
  const dryRun =
    process.argv.includes('--dry-run') ||
    process.env.ALLOW_FINALTEST_CLEANUP !== 'true';

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'finaltest-cleanup refuses to run with NODE_ENV=production',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const ai = app.get(AiServiceClient);
  const storage = app.get(StorageService);

  try {
    // Broad SQL filter, then an exact regex in code. The regex is the gate.
    const candidates = await prisma.user.findMany({
      where: { email: { startsWith: 'finaltest.', endsWith: '@example.test' } },
      select: {
        id: true,
        email: true,
        candidateAccount: {
          select: {
            id: true,
            personalDocuments: { select: { id: true, storageKey: true } },
            personalLinks: { select: { id: true } },
            candidates: { select: { id: true, organizationId: true } },
          },
        },
      },
    });

    const batch = candidates.filter((user) => isFinalTestEmail(user.email));
    const rejected = candidates.filter((user) => !isFinalTestEmail(user.email));
    for (const user of rejected) {
      logger.warn(`SKIPPING ${user.email}: not an exact batch identity`);
    }

    const documentCount = batch.reduce(
      (sum, u) => sum + (u.candidateAccount?.personalDocuments.length ?? 0),
      0,
    );
    const linkCount = batch.reduce(
      (sum, u) => sum + (u.candidateAccount?.personalLinks.length ?? 0),
      0,
    );
    const orgCandidateCount = batch.reduce(
      (sum, u) => sum + (u.candidateAccount?.candidates.length ?? 0),
      0,
    );

    logger.log(
      `Batch: ${batch.length} users, ${documentCount} personal documents, ` +
        `${linkCount} links, ${orgCandidateCount} org-side candidate rows`,
    );

    if (dryRun) {
      logger.log(
        '[dry-run] nothing was deleted. Set ALLOW_FINALTEST_CLEANUP=true to remove.',
      );
      for (const user of batch.slice(0, 5))
        logger.log(`  would delete ${user.email}`);
      if (batch.length > 5) logger.log(`  … and ${batch.length - 5} more`);
      return;
    }

    let vectorFailures = 0;
    for (const user of batch) {
      const account = user.candidateAccount;
      if (!account) continue;

      // 1 — vectors first, idempotently. A failure here is logged, not fatal:
      // a stale vector whose row is gone is invisible to every query, and
      // blocking cleanup on the AI service being up would be worse.
      for (const document of account.personalDocuments) {
        await ai.deletePersonalResume(account.id, document.id).catch(() => {
          vectorFailures += 1;
        });
      }
      for (const link of account.personalLinks) {
        await ai.deletePersonalWebSource(account.id, link.id).catch(() => {
          vectorFailures += 1;
        });
      }
      // Org-side COPIES made at apply time live in the tenant collection and
      // are keyed by their own document ids, so they are evicted individually.
      for (const orgCandidate of account.candidates) {
        const copies = await prisma.document.findMany({
          where: { candidateId: orgCandidate.id },
          select: { id: true, storageKey: true },
        });
        for (const copy of copies) {
          await ai
            .deleteDocument(orgCandidate.organizationId, copy.id)
            .catch(() => {
              vectorFailures += 1;
            });
          await storage.delete(copy.storageKey).catch(() => undefined);
        }
      }

      // 2 — org-side rows. Explicit because candidateAccountId is SetNull:
      // deleting only the user would leave applicant rows behind.
      for (const orgCandidate of account.candidates) {
        await prisma.candidate.delete({ where: { id: orgCandidate.id } });
      }

      // 3 — stored bytes, best effort.
      for (const document of account.personalDocuments) {
        await storage.delete(document.storageKey).catch(() => undefined);
      }

      // 4 — the person. Cascades to CandidateAccount, personal docs and links.
      await prisma.user.delete({ where: { id: user.id } });
    }

    logger.log(
      `Removed ${batch.length} final-test users` +
        (vectorFailures ? ` (${vectorFailures} vector evictions failed)` : ''),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
