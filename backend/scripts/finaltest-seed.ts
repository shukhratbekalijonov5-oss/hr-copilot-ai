/**
 * FINAL-TEST applicant dataset — brings two named vacancies to exactly 50
 * unique applicants each.
 *
 * DEVELOPMENT ONLY. Refuses to run unless `ALLOW_FINALTEST_SEED=true` and
 * NODE_ENV is not `production`.
 *
 *   ALLOW_FINALTEST_SEED=true npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/finaltest-seed.ts
 *   ... --dry-run     # plan and report only, writes nothing
 *
 * ## What it does NOT do
 *
 * No reset, no truncate, no reseed, no deletion of anything. It only ADDS
 * people, and only as many as are missing. Existing applicants — including the
 * re-application history already attached to Middle Backend Engineer — are
 * counted and left exactly as they are.
 *
 * ## Everything AI-visible goes through the real pipeline
 *
 *   resume      -> CandidateAccountService.uploadResume -> storage + Document
 *                  row + PROCESS_PERSONAL_RESUME job -> parser -> chunking ->
 *                  embeddings -> candidate_resume_chunks_v1 -> COMPLETED
 *   application -> PublicJobsService.apply -> org-scoped resume COPY +
 *                  ProcessingJob -> resume_chunks_v1
 *
 * No document status is ever written by hand and no vector is ever inserted
 * directly. Rows that carry no AI meaning (users, candidate accounts) are
 * written with Prisma, exactly as the ~200-user seeder does.
 *
 * ## Idempotency
 *
 * Safe to re-run. Every synthetic identity is deterministic
 * (`finaltest.<track>.<NNN>@example.test`), so a second run:
 *   1. re-counts what each vacancy actually has,
 *   2. REPAIRS half-finished batch members (missing resume, missing
 *      application) rather than creating duplicates for them,
 *   3. creates only the shortfall that remains.
 * A second run therefore converges on 50/50 instead of 100/97.
 *
 * If a vacancy already has MORE than the target from data this script did not
 * create, it stops and reports the conflict — reaching the target would mean
 * deleting somebody else's data, which is never this script's decision.
 */
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CandidateAccountService } from '../src/candidate-account/candidate-account.service';
import { PublicJobsService } from '../src/public-jobs/public-jobs.service';
import {
  AccountType,
  ApplicationSource,
  DocumentStatus,
  ProfileVisibility,
} from '../src/generated/prisma/enums';
import { buildDocx, DOCX_MIME } from './synthetic-seed.docx';
import {
  FINALTEST_PASSWORD,
  FINALTEST_SEED,
  planTrack,
  type PlannedFinalTestCandidate,
  type TrackKey,
} from './finaltest-seed.data';

const logger = new Logger('FinalTestSeed');

/** Exactly 50 unique PEOPLE per vacancy — not 50 application rows. */
const TARGET_PER_VACANCY = 50;

/**
 * The two target vacancies, resolved by title AND verified against the owner
 * the dev environment shows. They live in DIFFERENT organizations, which is
 * why ownership is checked per vacancy rather than once.
 */
const TARGETS: { track: TrackKey; title: string; expectedOwner: string }[] = [
  {
    track: 'frontend',
    title: 'Frontend Engineer',
    expectedOwner: 'owner@northwind-labs.test',
  },
  {
    track: 'backend',
    title: 'Middle Backend Engineer',
    expectedOwner: 'shukhratbekalijonov8@gmail.com',
  },
];

/** Tier mix per track, applied to the NEW people this run creates. */
const MIX: Record<TrackKey, { strong: number; medium: number; weak: number }> =
  {
    // ~15 strong / ~20 medium / ~15 weak across the finished 50-person pool.
    frontend: { strong: 15, medium: 20, weak: 15 },
    backend: { strong: 15, medium: 20, weak: 15 },
  };

/** Bounded concurrency: a laptop, one uvicorn worker and one Qdrant. */
const UPLOAD_CONCURRENCY = 4;
const APPLY_CONCURRENCY = 4;

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    })(),
  );
  await Promise.all(workers);
  return results;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ResolvedTarget {
  track: TrackKey;
  title: string;
  vacancyId: string;
  organizationId: string;
  publicSlug: string;
  ownerEmail: string;
  uniqueCandidates: number;
  applicationRows: number;
}

/** Unique PEOPLE with a legitimate application, the way the HR UI counts. */
async function countUnique(
  prisma: PrismaService,
  vacancyId: string,
): Promise<{ unique: number; rows: number }> {
  const applications = await prisma.application.findMany({
    where: {
      vacancyId,
      source: ApplicationSource.DIRECT,
      candidate: { candidateAccountId: { not: null } },
    },
    select: { candidateId: true },
  });
  return {
    unique: new Set(applications.map((a) => a.candidateId)).size,
    rows: applications.length,
  };
}

async function resolveTargets(
  prisma: PrismaService,
): Promise<ResolvedTarget[]> {
  const resolved: ResolvedTarget[] = [];
  for (const target of TARGETS) {
    const vacancies = await prisma.vacancy.findMany({
      where: { title: target.title },
      select: {
        id: true,
        title: true,
        status: true,
        publicSlug: true,
        organizationId: true,
        createdBy: { select: { email: true } },
      },
    });
    if (vacancies.length === 0) {
      throw new Error(`Vacancy "${target.title}" was not found`);
    }
    if (vacancies.length > 1) {
      throw new Error(
        `Vacancy title "${target.title}" is ambiguous (${vacancies.length} matches) — refusing to guess`,
      );
    }
    const vacancy = vacancies[0];
    if (vacancy.createdBy.email !== target.expectedOwner) {
      throw new Error(
        `Vacancy "${target.title}" is owned by ${vacancy.createdBy.email}, expected ${target.expectedOwner} — refusing to seed a vacancy that is not the intended one`,
      );
    }
    if (vacancy.status !== 'OPEN') {
      throw new Error(
        `Vacancy "${target.title}" is ${vacancy.status}; applying requires OPEN`,
      );
    }
    const counts = await countUnique(prisma, vacancy.id);
    resolved.push({
      track: target.track,
      title: vacancy.title,
      vacancyId: vacancy.id,
      organizationId: vacancy.organizationId,
      publicSlug: vacancy.publicSlug,
      ownerEmail: vacancy.createdBy.email,
      uniqueCandidates: counts.unique,
      applicationRows: counts.rows,
    });
  }
  return resolved;
}

/** Existing members of THIS batch, by track, with what they are missing. */
async function existingBatchMembers(prisma: PrismaService, track: TrackKey) {
  const users = await prisma.user.findMany({
    where: {
      email: { startsWith: `finaltest.${track}.`, endsWith: '@example.test' },
      accountType: AccountType.CANDIDATE,
    },
    select: {
      id: true,
      email: true,
      candidateAccount: {
        select: {
          id: true,
          resumeDocumentId: true,
          _count: { select: { personalDocuments: true } },
        },
      },
    },
    orderBy: { email: 'asc' },
  });
  return users;
}

/** The numeric index inside a batch email, or 1 when it cannot be read. */
function indexOfEmail(email: string, track: TrackKey): number {
  const match = new RegExp(
    `^finaltest\\.${track}\\.(\\d{3})@example\\.test$`,
  ).exec(email);
  return match ? Number(match[1]) : 1;
}

/** Highest index already used for a track, so new people continue the run. */
function highestIndex(emails: string[], track: TrackKey): number {
  let max = 0;
  for (const email of emails) {
    const match = new RegExp(
      `^finaltest\\.${track}\\.(\\d{3})@example\\.test$`,
    ).exec(email);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('finaltest-seed refuses to run with NODE_ENV=production');
  }
  if (process.env.ALLOW_FINALTEST_SEED !== 'true' && !dryRun) {
    throw new Error(
      'Set ALLOW_FINALTEST_SEED=true to run this development seeder',
    );
  }

  // 'log' stays enabled: this script's own progress IS the operator's view of
  // a long-running seed. Nest's noisier levels remain off.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const candidateAccounts = app.get(CandidateAccountService);
  const publicJobs = app.get(PublicJobsService);

  try {
    // --- 1. Resolve and verify the two vacancies -------------------------
    const targets = await resolveTargets(prisma);
    logger.log('Resolved targets:');
    for (const t of targets) {
      logger.log(
        `  ${t.title} [${t.vacancyId}] owner=${t.ownerEmail} ` +
          `unique=${t.uniqueCandidates} rows=${t.applicationRows}`,
      );
    }

    // --- 2. Refuse rather than delete ------------------------------------
    for (const t of targets) {
      if (t.uniqueCandidates > TARGET_PER_VACANCY) {
        throw new Error(
          `CONFLICT: "${t.title}" already has ${t.uniqueCandidates} unique candidates, ` +
            `more than the target of ${TARGET_PER_VACANCY}. Reaching the target would ` +
            `require deleting existing data, which this script will not do. Stopping.`,
        );
      }
    }

    const passwordHash = await bcrypt.hash(FINALTEST_PASSWORD, 10);
    const report: Record<string, unknown>[] = [];

    for (const target of targets) {
      // --- 3. Repair half-finished batch members from an earlier run -----
      const existing = await existingBatchMembers(prisma, target.track);
      const repaired = { resumes: 0, applications: 0 };

      for (const user of existing) {
        if (!user.candidateAccount) continue;
        const appliedAlready = await prisma.application.findFirst({
          where: {
            vacancyId: target.vacancyId,
            candidate: { candidateAccountId: user.candidateAccount.id },
          },
          select: { id: true },
        });
        if (appliedAlready) continue;

        // Missing resume → the apply below would be rejected without one.
        if (!user.candidateAccount.resumeDocumentId) {
          logger.warn(`Repairing ${user.email}: no resume on the account`);
          if (!dryRun) {
            // Rebuild THIS person's resume from their own index, so a repaired
            // account gets its own document rather than a copy of person 001.
            const own = indexOfEmail(user.email, target.track);
            const plan = planTrack(
              target.track,
              MIX[target.track],
              own,
              FINALTEST_SEED,
            )[0];
            const buffer = buildDocx(plan.resumeLines);
            await candidateAccounts.uploadResume(user.id, {
              originalname: plan.resumeFileName,
              mimetype: DOCX_MIME,
              size: buffer.length,
              buffer,
            });
            repaired.resumes += 1;
          }
        }
        if (!dryRun) {
          try {
            await publicJobs.apply(user.id, target.publicSlug);
            repaired.applications += 1;
          } catch (error) {
            logger.warn(
              `Repair apply failed for ${user.email}: ${(error as Error).message}`,
            );
          }
        }
      }

      // --- 4. How many people are still missing --------------------------
      const after = await countUnique(prisma, target.vacancyId);
      const needed = Math.max(0, TARGET_PER_VACANCY - after.unique);
      const startIndex =
        highestIndex(
          existing.map((u) => u.email),
          target.track,
        ) + 1;

      logger.log(
        `${target.title}: have ${after.unique}, need ${needed} more ` +
          `(new indexes start at ${String(startIndex).padStart(3, '0')})`,
      );

      if (needed === 0) {
        report.push({
          vacancy: target.title,
          created: 0,
          repaired,
          final: after.unique,
        });
        continue;
      }

      // The plan is generated for the full mix, then sliced to the shortfall,
      // so the tier distribution stays representative whatever the shortfall is.
      const planned = planTrack(
        target.track,
        MIX[target.track],
        startIndex,
        FINALTEST_SEED,
      ).slice(0, needed);

      if (dryRun) {
        logger.log(`[dry-run] would create ${planned.length} candidates:`);
        for (const person of planned.slice(0, 3)) {
          logger.log(
            `  ${person.email} | ${person.fullName} | ${person.tier} | ${person.headline} | ${person.years}y`,
          );
        }
        report.push({
          vacancy: target.title,
          wouldCreate: planned.length,
          repaired,
          current: after.unique,
          plan: describePlan(planned),
        });
        continue;
      }

      // --- 5. Accounts (plain rows — no AI meaning) ----------------------
      const userIds: string[] = [];
      for (const person of planned) {
        const created = await prisma.user.create({
          data: {
            email: person.email,
            passwordHash,
            fullName: person.fullName,
            accountType: AccountType.CANDIDATE,
            preferredLocale: 'en',
            candidateAccount: {
              create: {
                headline: person.headline,
                location: person.location,
                phone: person.phone,
                summary: person.summary,
                skills: person.skills,
                languages: person.languages,
                experience: person.experience,
                education: person.education,
                profileVisibility: ProfileVisibility.PRIVATE,
              },
            },
          },
          select: { id: true },
        });
        userIds.push(created.id);
      }
      logger.log(`${target.title}: created ${userIds.length} accounts`);

      // --- 6. Resumes through the REAL upload path -----------------------
      let uploadFailures = 0;
      await mapLimit(planned, UPLOAD_CONCURRENCY, async (person, i) => {
        const buffer = buildDocx(person.resumeLines);
        try {
          await candidateAccounts.uploadResume(userIds[i], {
            originalname: person.resumeFileName,
            mimetype: DOCX_MIME,
            size: buffer.length,
            buffer,
          });
        } catch (error) {
          uploadFailures += 1;
          logger.warn(
            `Upload failed for ${person.email}: ${(error as Error).message}`,
          );
        }
      });
      logger.log(
        `${target.title}: uploaded ${planned.length - uploadFailures} resumes`,
      );

      // --- 7. Applications through the REAL apply path -------------------
      // ONE application per new person: this batch does not exercise reapply.
      let applied = 0;
      let applyFailures = 0;
      await mapLimit(planned, APPLY_CONCURRENCY, async (person, i) => {
        try {
          await publicJobs.apply(userIds[i], target.publicSlug);
          applied += 1;
        } catch (error) {
          applyFailures += 1;
          logger.warn(
            `Apply failed for ${person.email}: ${(error as Error).message}`,
          );
        }
      });

      const final = await countUnique(prisma, target.vacancyId);
      logger.log(
        `${target.title}: applied ${applied} (${applyFailures} failed) → unique now ${final.unique}`,
      );
      report.push({
        vacancy: target.title,
        created: userIds.length,
        repaired,
        applied,
        applyFailures,
        uploadFailures,
        final: final.unique,
        tierMix: planned.reduce<Record<string, number>>((acc, p) => {
          acc[p.tier] = (acc[p.tier] ?? 0) + 1;
          return acc;
        }, {}),
      });
    }

    // --- 8. Wait for the real processing pipeline ------------------------
    if (!dryRun) {
      const processing = await waitForBatchProcessing(prisma);
      logger.log(
        `processing: ${processing.completed} completed, ${processing.failed} failed, ` +
          `${processing.pending} still pending after ${processing.waitedSeconds.toFixed(0)}s`,
      );
      report.push({ processing });
    }

    logger.log('\n=== FINAL TEST SEED REPORT ===');
    logger.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}

/**
 * Plan statistics — what a reviewer needs to judge whether the dataset is
 * varied enough BEFORE 97 resumes are written and embedded.
 */
function describePlan(planned: PlannedFinalTestCandidate[]) {
  const tally = <T>(items: T[]) =>
    items.reduce<Record<string, number>>((acc, item) => {
      acc[String(item)] = (acc[String(item)] ?? 0) + 1;
      return acc;
    }, {});
  const lengths = planned.map((p) => p.resumeLines.join('\n').length);
  return {
    tiers: tally(planned.map((p) => p.tier)),
    yearsSpread: tally(planned.map((p) => p.years)),
    uniqueNames: new Set(planned.map((p) => p.fullName)).size,
    uniqueEmails: new Set(planned.map((p) => p.email)).size,
    uniqueHeadlines: new Set(planned.map((p) => p.headline)).size,
    uniqueResumeBodies: new Set(planned.map((p) => p.resumeLines.join('\n')))
      .size,
    uniqueEmployers: new Set(
      planned.flatMap((p) => p.experience.map((e) => e.company)),
    ).size,
    resumeChars: {
      min: Math.min(...lengths),
      max: Math.max(...lengths),
      avg: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    },
  };
}

/** Waits for THIS batch's personal documents to leave pre-COMPLETED states. */
async function waitForBatchProcessing(
  prisma: PrismaService,
  { timeoutMs = 20 * 60_000, stallMs = 120_000 } = {},
) {
  const pendingStatuses = [
    DocumentStatus.UPLOADED,
    DocumentStatus.QUEUED,
    DocumentStatus.PARSING,
    DocumentStatus.CHUNKING,
    DocumentStatus.EMBEDDING,
    DocumentStatus.INDEXING,
  ];
  const where = {
    candidateAccount: {
      user: { email: { startsWith: 'finaltest.', endsWith: '@example.test' } },
    },
  };

  const started = Date.now();
  let lastPending = Number.POSITIVE_INFINITY;
  let quietSince = Date.now();
  for (;;) {
    const [pending, completed, failed] = await Promise.all([
      prisma.document.count({
        where: { ...where, status: { in: pendingStatuses } },
      }),
      prisma.document.count({
        where: { ...where, status: DocumentStatus.COMPLETED },
      }),
      prisma.document.count({
        where: { ...where, status: DocumentStatus.FAILED },
      }),
    ]);
    const waitedSeconds = (Date.now() - started) / 1000;
    if (pending === 0) return { completed, failed, pending, waitedSeconds };
    if (pending !== lastPending) {
      lastPending = pending;
      quietSince = Date.now();
      logger.log(
        `processing: ${pending} pending, ${completed} completed, ${failed} failed`,
      );
    } else if (Date.now() - quietSince > stallMs) {
      logger.warn(`processing stalled with ${pending} pending`);
      return { completed, failed, pending, waitedSeconds };
    }
    if (Date.now() - started > timeoutMs) {
      logger.warn(`processing budget exhausted with ${pending} pending`);
      return { completed, failed, pending, waitedSeconds };
    }
    await sleep(3_000);
  }
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
