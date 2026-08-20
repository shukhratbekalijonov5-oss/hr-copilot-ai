/**
 * Synthetic development dataset — ~200 users at realistic scale.
 *
 * DEVELOPMENT ONLY. Refuses to run unless `ALLOW_SYNTHETIC_SEED=true` and
 * NODE_ENV is not `production`.
 *
 *   npm run seed:synthetic          # create (refuses if already present)
 *   npm run seed:synthetic:reset    # remove ONLY this seeder's records
 *
 * Everything AI-visible goes through the REAL pipeline — no vector is ever
 * written directly:
 *
 *   personal resume  → CandidateAccountService.uploadResume → storage +
 *                      Document row + PROCESS_PERSONAL_RESUME job → parser →
 *                      chunking → embeddings → candidate_resume_chunks_v1
 *   application      → PublicJobsService.apply → org-scoped resume COPY +
 *                      ProcessingJob + PROCESS_DOCUMENT job → resume_chunks_v1
 *   vacancy          → SYNC_VACANCY_INDEX job → embeddings → vacancy_chunks_v1
 *
 * Privacy semantics are therefore untouched: organizations only ever see the
 * copies that real applications produce, and personal vectors stay in the
 * candidate-only collection.
 *
 * Rows that carry no AI meaning (users, memberships, profiles, requirements)
 * are written with Prisma directly, exactly as prisma/seed.ts does — with one
 * shared bcrypt hash instead of 200 (a per-user hash would add minutes and
 * prove nothing).
 *
 * IDEMPOTENCY: the seeder REFUSES to run when its own records already exist.
 * Re-seeding is `reset` then `seed`; the fixed RNG seed makes that reproduce
 * the same dataset. (Upserting was rejected: vacancy publicSlugs carry a
 * random suffix and applications create real storage objects, so "update in
 * place" would silently diverge from a fresh run.)
 */
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { CandidateAccountService } from '../src/candidate-account/candidate-account.service';
import { PublicJobsService } from '../src/public-jobs/public-jobs.service';
import { VacanciesService } from '../src/vacancies/vacancies.service';
import { DocumentProcessingProducer } from '../src/queue/document-processing.producer';
import { AiServiceClient } from '../src/ai/ai-service.client';
import { SearchService } from '../src/search/search.service';
import type { Prisma } from '../src/generated/prisma/client';
import {
  AccountType,
  DocumentStatus,
  ProfileVisibility,
  RequirementType,
  Role,
  VacancyStatus,
} from '../src/generated/prisma/enums';
import { buildDocx, DOCX_MIME } from './synthetic-seed.docx';
import {
  SYNTHETIC_ORG_SLUG_PREFIX,
  SYNTHETIC_PASSWORD,
  buildPlan,
  isSyntheticEmail,
  planSummary,
  type PlannedVacancy,
  type SyntheticPlan,
} from './synthetic-seed.plan';

const logger = new Logger('SyntheticSeed');

/** Qdrant collections the project uses, mirrored from ai-service config. */
const COLLECTIONS = {
  organizationResumes: 'resume_chunks_v1',
  candidateResumes: 'candidate_resume_chunks_v1',
  vacancies: 'vacancy_chunks_v1',
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Bounded-concurrency map: keeps a laptop (and one uvicorn worker) alive. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]!, index);
      }
    })(),
  );
  await Promise.all(workers);
  return results;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Timings {
  private readonly marks: [string, number][] = [];

  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      const seconds = (Date.now() - started) / 1000;
      this.marks.push([label, seconds]);
      logger.log(`${label}: ${seconds.toFixed(1)}s`);
    }
  }

  record(label: string, seconds: number) {
    this.marks.push([label, seconds]);
  }

  report(): string {
    return this.marks
      .map(([label, seconds]) => `  ${label.padEnd(38)} ${seconds.toFixed(1)}s`)
      .join('\n');
  }
}

/** Read-only Qdrant point counts, for the index report. */
async function collectionCounts(): Promise<Record<string, number | string>> {
  const url = process.env.QDRANT_URL ?? 'http://localhost:6333';
  const out: Record<string, number | string> = {};
  for (const [label, collection] of Object.entries(COLLECTIONS)) {
    try {
      const response = await fetch(`${url}/collections/${collection}`);
      if (!response.ok) {
        out[collection] = response.status === 404 ? 'absent' : `HTTP ${response.status}`;
        continue;
      }
      const body = (await response.json()) as {
        result?: { points_count?: number };
      };
      out[collection] = body.result?.points_count ?? 0;
      void label;
    } catch (error) {
      out[collection] = `unreachable (${(error as Error).message})`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

function assertSafeEnvironment(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the synthetic seeder with NODE_ENV=production');
  }
  if (process.env.ALLOW_SYNTHETIC_SEED !== 'true') {
    throw new Error(
      'Refusing to run: set ALLOW_SYNTHETIC_SEED=true to confirm this is a development database',
    );
  }
  const url = process.env.DATABASE_URL ?? '';
  if (/(^|[^a-z])prod([^a-z]|$)/i.test(url)) {
    throw new Error(`Refusing to run: DATABASE_URL looks production-like`);
  }
}

// ---------------------------------------------------------------------------
// Existing-dataset detection & reset
// ---------------------------------------------------------------------------

async function findSynthetic(prisma: PrismaService) {
  const [candidateEmails, orgs] = await Promise.all([
    prisma.user.findMany({
      where: { email: { endsWith: '@example.test' } },
      select: { id: true, email: true },
    }),
    prisma.organization.findMany({
      where: { slug: { startsWith: SYNTHETIC_ORG_SLUG_PREFIX } },
      select: { id: true, slug: true },
    }),
  ]);
  // Regex-filtered in JS: Prisma has no regex operator, and the pattern is what
  // keeps hand-made dev accounts (jasur.toshmatov@…, candidate-auth-test@…)
  // out of the reset.
  const users = candidateEmails.filter((u) => isSyntheticEmail(u.email));
  return { users, orgs };
}

async function reset(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>) {
  const prisma = app.get(PrismaService);
  const storage = app.get(StorageService);
  const ai = app.get(AiServiceClient);
  const { users, orgs } = await findSynthetic(prisma);

  if (users.length === 0 && orgs.length === 0) {
    logger.log('Nothing to reset: no synthetic records found.');
    return;
  }
  logger.log(`Resetting ${users.length} synthetic users and ${orgs.length} synthetic organizations`);

  const userIds = users.map((u) => u.id);
  const orgIds = orgs.map((o) => o.id);

  // 1. Collect everything that has an AI index footprint BEFORE deleting rows.
  const [personalDocs, orgDocs, vacancies] = await Promise.all([
    prisma.document.findMany({
      where: { candidateAccount: { userId: { in: userIds } } },
      select: { id: true, storageKey: true, candidateAccountId: true },
    }),
    prisma.document.findMany({
      where: { organizationId: { in: orgIds } },
      select: { id: true, storageKey: true, organizationId: true },
    }),
    prisma.vacancy.findMany({
      where: { organizationId: { in: orgIds } },
      select: { id: true },
    }),
  ]);

  // 2. Evict vectors through the real AI endpoints (best effort: a stopped
  //    ai-service must not block a database reset).
  let aiFailures = 0;
  const evict = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      aiFailures += 1;
    }
  };
  await mapLimit(personalDocs, 4, (doc) =>
    evict(() => ai.deletePersonalResume(doc.candidateAccountId!, doc.id)),
  );
  await mapLimit(orgDocs, 4, (doc) =>
    evict(() => ai.deleteDocument(doc.organizationId!, doc.id)),
  );
  await mapLimit(vacancies, 4, (vacancy) =>
    evict(() => ai.deleteVacancyIndex(vacancy.id)),
  );
  if (aiFailures > 0) {
    logger.warn(
      `${aiFailures} AI index deletions failed (ai-service down?). Vectors for removed rows may linger; re-run reset with ai-service up to clear them.`,
    );
  }

  // 3. Stored objects (the database cascade cannot reach the filesystem).
  await mapLimit([...personalDocs, ...orgDocs], 8, (doc) =>
    storage.delete(doc.storageKey).catch(() => undefined),
  );

  // 4. Rows. Organizations cascade members/vacancies/candidates/applications/
  //    documents/processing jobs; users cascade candidate accounts, personal
  //    documents, saved jobs and auth sessions.
  const deletedOrgs = await prisma.organization.deleteMany({
    where: { id: { in: orgIds } },
  });
  const deletedUsers = await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });

  logger.log(
    `Reset complete: ${deletedUsers.count} users, ${deletedOrgs.count} organizations, ` +
      `${personalDocs.length} personal + ${orgDocs.length} organization documents, ${vacancies.length} vacancies`,
  );
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const REQUIREMENT_TYPES: Record<string, RequirementType> = {
  SKILL: RequirementType.SKILL,
  EXPERIENCE: RequirementType.EXPERIENCE,
  EDUCATION: RequirementType.EDUCATION,
  LANGUAGE: RequirementType.LANGUAGE,
  OTHER: RequirementType.OTHER,
};

const STATUSES: Record<string, VacancyStatus> = {
  DRAFT: VacancyStatus.DRAFT,
  OPEN: VacancyStatus.OPEN,
  CLOSED: VacancyStatus.CLOSED,
  ARCHIVED: VacancyStatus.ARCHIVED,
};

const ROLES: Record<string, Role> = {
  OWNER: Role.OWNER,
  HR_ADMIN: Role.HR_ADMIN,
  RECRUITER: Role.RECRUITER,
  INTERVIEWER: Role.INTERVIEWER,
};

/** Locale for the account, derived from the resume language. */
const LOCALES = { en: 'en', ko: 'ko', ru: 'ru', uz: 'uz' } as const;

async function seed(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  plan: SyntheticPlan,
  timings: Timings,
) {
  const prisma = app.get(PrismaService);
  const candidateAccounts = app.get(CandidateAccountService);
  const publicJobs = app.get(PublicJobsService);
  const vacanciesService = app.get(VacanciesService);
  const producer = app.get(DocumentProcessingProducer);

  const passwordHash = await bcrypt.hash(SYNTHETIC_PASSWORD, 10);

  // --- Organizations -------------------------------------------------------
  const orgIds = await timings.measure('organizations', async () => {
    const ids: string[] = [];
    for (const org of plan.orgs) {
      const created = await prisma.organization.create({
        data: { name: org.name, slug: org.slug },
        select: { id: true },
      });
      ids.push(created.id);
    }
    return ids;
  });

  // --- ORGANIZATION accounts + memberships --------------------------------
  const orgUserIds = await timings.measure('organization users', async () => {
    const ids: string[] = [];
    for (const user of plan.orgUsers) {
      const created = await prisma.user.create({
        data: {
          email: user.email,
          passwordHash,
          fullName: user.fullName,
          accountType: AccountType.ORGANIZATION,
          memberships: {
            create: user.memberships.map((m) => ({
              organizationId: orgIds[m.orgIndex]!,
              role: ROLES[m.role]!,
            })),
          },
        },
        select: { id: true },
      });
      ids.push(created.id);
    }
    return ids;
  });

  /** The OWNER of each organization, used as vacancy creator. */
  const ownerByOrgIndex = new Map<number, string>();
  plan.orgUsers.forEach((user, index) => {
    for (const membership of user.memberships) {
      if (membership.role === 'OWNER') {
        ownerByOrgIndex.set(membership.orgIndex, orgUserIds[index]!);
      }
    }
  });

  // --- CANDIDATE accounts + profiles --------------------------------------
  const candidateUserIds = await timings.measure('candidate users + profiles', async () => {
    const ids: string[] = [];
    for (const candidate of plan.candidates) {
      const created = await prisma.user.create({
        data: {
          email: candidate.email,
          passwordHash,
          fullName: candidate.fullName,
          accountType: AccountType.CANDIDATE,
          preferredLocale: LOCALES[candidate.resumeLocale],
          candidateAccount: {
            create: {
              headline: candidate.headline,
              location: candidate.location,
              phone: candidate.phone,
              summary: candidate.summary,
              skills: candidate.skills,
              languages: candidate.languages,
              // Same cast the service uses: these are validated-JSON arrays.
              experience: candidate.experience as unknown as Prisma.InputJsonValue,
              education: candidate.education as unknown as Prisma.InputJsonValue,
              profileVisibility: ProfileVisibility.PRIVATE,
            },
          },
        },
        select: { id: true },
      });
      ids.push(created.id);
    }
    return ids;
  });

  // --- Vacancies + requirements -------------------------------------------
  // Rows through the real service (public slug generation, tenancy checks);
  // requirements in bulk; then ONE index sync per vacancy. The sync worker
  // reconciles from current database state, so a single job after all the
  // requirements exist indexes the finished vacancy — instead of re-embedding
  // it once per requirement.
  const vacancyIds = await timings.measure('vacancies + requirements', async () => {
    const ids: string[] = new Array(plan.vacancies.length);
    const byOrg = new Map<number, { vacancy: PlannedVacancy; index: number }[]>();
    plan.vacancies.forEach((vacancy, index) => {
      const list = byOrg.get(vacancy.orgIndex) ?? [];
      list.push({ vacancy, index });
      byOrg.set(vacancy.orgIndex, list);
    });

    await mapLimit([...byOrg.entries()], 6, async ([orgIndex, entries]) => {
      const organizationId = orgIds[orgIndex]!;
      const createdById = ownerByOrgIndex.get(orgIndex)!;
      for (const { vacancy, index } of entries) {
        const created = await vacanciesService.create(organizationId, createdById, {
          title: vacancy.title,
          department: vacancy.department,
          location: vacancy.location,
          employmentType: vacancy.employmentType,
          experienceLevel: vacancy.experienceLevel,
          description: vacancy.description,
          status: STATUSES[vacancy.status]!,
        });
        ids[index] = created.id;
        await prisma.jobRequirement.createMany({
          data: vacancy.requirements.map((requirement) => ({
            vacancyId: created.id,
            text: requirement.text,
            type: REQUIREMENT_TYPES[requirement.type]!,
            required: requirement.required,
          })),
        });
        await producer.enqueueVacancyIndexSync({ vacancyId: created.id });
      }
    });
    return ids;
  });

  // --- Personal resumes through the real upload path ----------------------
  const withResume = plan.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.hasResume);

  await timings.measure('personal resume uploads (enqueued)', async () => {
    await mapLimit(withResume, 6, async ({ candidate, index }) => {
      const buffer = buildDocx(candidate.resumeLines);
      await candidateAccounts.uploadResume(candidateUserIds[index]!, {
        originalname: candidate.resumeFileName,
        mimetype: DOCX_MIME,
        size: buffer.length,
        buffer,
      });
    });
  });

  // --- Applications through the real apply path ---------------------------
  // Sequential per candidate (the duplicate rules are per candidate account),
  // parallel across candidates.
  const byCandidate = new Map<number, number[]>();
  for (const application of plan.applications) {
    const list = byCandidate.get(application.candidateIndex) ?? [];
    list.push(application.vacancyIndex);
    byCandidate.set(application.candidateIndex, list);
  }

  let applied = 0;
  let applyFailures = 0;
  await timings.measure('applications (enqueued)', async () => {
    await mapLimit([...byCandidate.entries()], 5, async ([candidateIndex, vacancyIndexes]) => {
      const userId = candidateUserIds[candidateIndex]!;
      for (const vacancyIndex of vacancyIndexes) {
        const slug = await slugFor(prisma, vacancyIds[vacancyIndex]!);
        try {
          await publicJobs.apply(userId, slug);
          applied += 1;
        } catch (error) {
          applyFailures += 1;
          if (applyFailures <= 3) {
            logger.warn(`apply failed (${slug}): ${(error as Error).message}`);
          }
        }
      }
    });
  });

  // --- Saved jobs through the real service --------------------------------
  let saved = 0;
  await timings.measure('saved jobs', async () => {
    const bySaver = new Map<number, number[]>();
    for (const savedJob of plan.savedJobs) {
      const list = bySaver.get(savedJob.candidateIndex) ?? [];
      list.push(savedJob.vacancyIndex);
      bySaver.set(savedJob.candidateIndex, list);
    }
    await mapLimit([...bySaver.entries()], 8, async ([candidateIndex, vacancyIndexes]) => {
      const userId = candidateUserIds[candidateIndex]!;
      for (const vacancyIndex of vacancyIndexes) {
        const slug = await slugFor(prisma, vacancyIds[vacancyIndex]!);
        await candidateAccounts.saveJob(userId, slug).then(
          () => {
            saved += 1;
          },
          () => undefined,
        );
      }
    });
  });

  // --- Close some saved vacancies (saved-but-closed state) ----------------
  await timings.measure('close saved vacancies', async () => {
    for (const vacancyIndex of plan.closeAfterSave) {
      const vacancyId = vacancyIds[vacancyIndex]!;
      const organizationId = orgIds[plan.vacancies[vacancyIndex]!.orgIndex]!;
      await vacanciesService
        .setStatus(organizationId, vacancyId, VacancyStatus.CLOSED)
        .catch(() => undefined);
    }
  });

  return { orgIds, orgUserIds, candidateUserIds, vacancyIds, applied, saved };
}

const slugCache = new Map<string, string>();
async function slugFor(prisma: PrismaService, vacancyId: string): Promise<string> {
  const cached = slugCache.get(vacancyId);
  if (cached) return cached;
  const vacancy = await prisma.vacancy.findUniqueOrThrow({
    where: { id: vacancyId },
    select: { publicSlug: true },
  });
  slugCache.set(vacancyId, vacancy.publicSlug);
  return vacancy.publicSlug;
}

// ---------------------------------------------------------------------------
// Waiting for the real pipeline to drain
// ---------------------------------------------------------------------------

/**
 * Waits until no synthetic document is left in a pre-COMPLETED state.
 *
 * Watches database status rather than the queue so it also covers work picked
 * up by a separately running backend process. Returns whatever is still
 * outstanding when the budget runs out — a slow index is a reportable fact,
 * not a reason to fail the seed.
 */
async function waitForProcessing(
  prisma: PrismaService,
  { timeoutMs = 30 * 60_000, quietMs = 15_000 } = {},
): Promise<{ completed: number; failed: number; pending: number; waitedSeconds: number }> {
  const started = Date.now();
  const pendingStatuses = [
    DocumentStatus.UPLOADED,
    DocumentStatus.QUEUED,
    DocumentStatus.PARSING,
    DocumentStatus.CHUNKING,
    DocumentStatus.EMBEDDING,
    DocumentStatus.INDEXING,
  ];
  const where = {
    OR: [
      { organization: { slug: { startsWith: SYNTHETIC_ORG_SLUG_PREFIX } } },
      { candidateAccount: { user: { email: { endsWith: '@example.test' } } } },
    ],
  };

  let lastPending = Number.POSITIVE_INFINITY;
  let quietSince = Date.now();
  for (;;) {
    const [pending, completed, failed] = await Promise.all([
      prisma.document.count({ where: { ...where, status: { in: pendingStatuses } } }),
      prisma.document.count({ where: { ...where, status: DocumentStatus.COMPLETED } }),
      prisma.document.count({ where: { ...where, status: DocumentStatus.FAILED } }),
    ]);
    const waitedSeconds = (Date.now() - started) / 1000;

    if (pending === 0) return { completed, failed, pending, waitedSeconds };
    if (pending !== lastPending) {
      lastPending = pending;
      quietSince = Date.now();
      logger.log(`processing: ${pending} pending, ${completed} completed, ${failed} failed`);
    } else if (Date.now() - quietSince > quietMs * 20) {
      // Nothing moved for a long time: a dead worker, not slow progress.
      logger.warn(`processing stalled with ${pending} documents pending`);
      return { completed, failed, pending, waitedSeconds };
    }
    if (Date.now() - started > timeoutMs) {
      logger.warn(`processing budget exhausted with ${pending} documents pending`);
      return { completed, failed, pending, waitedSeconds };
    }
    await sleep(3_000);
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verify(
  app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>,
  plan: SyntheticPlan,
  timings: Timings,
) {
  const prisma = app.get(PrismaService);
  const search = app.get(SearchService);
  const candidateAccounts = app.get(CandidateAccountService);

  // --- Invariant: no dual identity anywhere ------------------------------
  const [dualUsers, candidatesWithMembership, orgUsersWithProfile] = await Promise.all([
    prisma.user.count({
      where: {
        AND: [{ candidateAccount: { isNot: null } }, { memberships: { some: {} } }],
      },
    }),
    prisma.user.count({
      where: { accountType: AccountType.CANDIDATE, memberships: { some: {} } },
    }),
    prisma.user.count({
      where: { accountType: AccountType.ORGANIZATION, candidateAccount: { isNot: null } },
    }),
  ]);

  // --- Recruiter AI search on a seeded organization ----------------------
  const searchOrg = await prisma.organization.findFirstOrThrow({
    where: { slug: { startsWith: SYNTHETIC_ORG_SLUG_PREFIX } },
    orderBy: { slug: 'asc' },
    select: { id: true, slug: true, name: true },
  });

  const DEMO_QUERIES = [
    'I need a backend engineer with NestJS and PostgreSQL',
    'Docker va Kubernetes biladigan DevOps hodim kerak',
    "React va TypeScript bo'yicha kuchli frontend developer top",
    'Korean speaking backend engineer',
  ];

  const searchResults = await timings.measure('recruiter AI search (4 queries)', async () => {
    const rows: {
      query: string;
      hits: number;
      topCandidate: string | null;
      topFile: string | null;
      seconds: number;
    }[] = [];
    for (const query of DEMO_QUERIES) {
      const started = Date.now();
      try {
        const result = await search.searchEvidence(searchOrg.id, {
          query,
          limit: 5,
        });
        const top = result.results[0];
        rows.push({
          query,
          hits: result.results.length,
          topCandidate: top?.candidateName ?? null,
          topFile: top?.fileName ?? null,
          seconds: (Date.now() - started) / 1000,
        });
      } catch (error) {
        rows.push({
          query,
          hits: -1,
          topCandidate: `error: ${(error as Error).message}`,
          topFile: null,
          seconds: (Date.now() - started) / 1000,
        });
      }
    }
    return rows;
  });

  // --- Candidate AI Job Match on a SMALL sample --------------------------
  // Gemini is only touched here: a handful of users, never the whole dataset.
  const sampleEmails = [
    plan.powerApplicantEmail,
    ...plan.candidates
      .filter((c) => c.hasResume && ['devops', 'frontend'].includes(c.trackKey))
      .slice(0, 2)
      .map((c) => c.email),
  ];
  const matchResults = await timings.measure('candidate job match (sample)', async () => {
    const rows: {
      email: string;
      matches: number;
      labels: string[];
      titles: string[];
      generated: boolean;
      seconds: number;
    }[] = [];
    for (const email of sampleEmails) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) continue;
      const started = Date.now();
      try {
        const result = await candidateAccounts.jobMatches(user.id, { limit: 5 });
        rows.push({
          email,
          matches: result.matches.length,
          labels: result.matches.map((m) => m.match),
          titles: result.matches.map((m) => m.vacancy.title),
          generated: result.generated,
          seconds: (Date.now() - started) / 1000,
        });
      } catch (error) {
        rows.push({
          email,
          matches: -1,
          labels: [`error: ${(error as Error).message}`],
          titles: [],
          generated: false,
          seconds: (Date.now() - started) / 1000,
        });
      }
    }
    return rows;
  });

  // --- Listing latency for the power applicant ---------------------------
  const powerUser = await prisma.user.findUniqueOrThrow({
    where: { email: plan.powerApplicantEmail },
    select: { id: true },
  });
  const listing = await timings.measure('my applications (page 1 of power applicant)', async () => {
    const result = await candidateAccounts.listMyApplications(powerUser.id, {
      page: 1,
      limit: 20,
      skip: 0,
    });
    return result.meta;
  });

  return {
    dualUsers,
    candidatesWithMembership,
    orgUsersWithProfile,
    searchOrg,
    searchResults,
    matchResults,
    listing,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const mode = process.argv.includes('--reset') ? 'reset' : 'seed';
  assertSafeEnvironment();

  const applicationScale = Number(process.env.SYNTHETIC_APPLICATION_SCALE ?? '1');
  const plan = buildPlan(undefined, { applicationScale });
  const summary = planSummary(plan);
  const timings = new Timings();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  // NOTE: booting AppModule also starts a BullMQ worker in this process
  // (concurrency 2). With the dev server running too, both drain the queue.

  try {
    if (mode === 'reset') {
      await timings.measure('reset', () => reset(app));
      console.log(`\nRESET COMPLETE\n${timings.report()}`);
      return;
    }

    const prisma = app.get(PrismaService);
    const existing = await findSynthetic(prisma);
    if (existing.users.length > 0 || existing.orgs.length > 0) {
      throw new Error(
        `Synthetic dataset already present (${existing.users.length} users, ${existing.orgs.length} organizations). ` +
          `Run "npm run seed:synthetic:reset" first — this seeder never updates in place.`,
      );
    }

    console.log('\nPLAN');
    console.log(JSON.stringify(summary, null, 2));

    const created = await timings.measure('database creation (total)', () =>
      seed(app, plan, timings),
    );

    logger.log('Waiting for the real processing pipeline to drain…');
    const processing = await timings.measure('pipeline drain (resumes + org copies)', () =>
      waitForProcessing(prisma),
    );

    const counts = await collectionCounts();
    const verification = await verify(app, plan, timings);

    const rows = await Promise.all([
      prisma.user.count({ where: { accountType: AccountType.CANDIDATE, email: { endsWith: '@example.test' } } }),
      prisma.user.count({ where: { accountType: AccountType.ORGANIZATION, email: { endsWith: '@example.test' } } }),
      prisma.vacancy.count({ where: { organization: { slug: { startsWith: SYNTHETIC_ORG_SLUG_PREFIX } } } }),
      prisma.vacancy.count({
        where: {
          organization: { slug: { startsWith: SYNTHETIC_ORG_SLUG_PREFIX } },
          status: VacancyStatus.OPEN,
        },
      }),
      prisma.application.count({
        where: { vacancy: { organization: { slug: { startsWith: SYNTHETIC_ORG_SLUG_PREFIX } } } },
      }),
      prisma.savedJob.count({
        where: { candidateAccount: { user: { email: { endsWith: '@example.test' } } } },
      }),
      prisma.candidate.count({
        where: { organization: { slug: { startsWith: SYNTHETIC_ORG_SLUG_PREFIX } } },
      }),
    ]);

    console.log(`
================================================================
SYNTHETIC DATASET READY  (seed ${plan.seed})
================================================================
DATABASE
  candidate users        ${rows[0]}
  organization users     ${rows[1]}
  organizations          ${created.orgIds.length}
  vacancies              ${rows[2]} (${rows[3]} OPEN)
  applications           ${rows[4]}
  saved jobs             ${rows[5]}
  org-side candidates    ${rows[6]}
  personal resumes       ${summary.resumes}

PIPELINE (real queue → parser → embeddings → Qdrant)
  documents completed    ${processing.completed}
  documents failed       ${processing.failed}
  documents still pending${processing.pending}
  drain time             ${processing.waitedSeconds.toFixed(1)}s

QDRANT COLLECTIONS
${Object.entries(counts).map(([c, n]) => `  ${c.padEnd(30)} ${n}`).join('\n')}

IDENTITY INVARIANT
  dual-identity users            ${verification.dualUsers}
  CANDIDATE with membership      ${verification.candidatesWithMembership}
  ORGANIZATION with profile      ${verification.orgUsersWithProfile}

RECRUITER AI SEARCH (org ${verification.searchOrg.slug})
${verification.searchResults
  .map(
    (r) =>
      `  "${r.query}"\n    hits=${r.hits} top=${r.topCandidate ?? '—'} file=${r.topFile ?? '—'} (${r.seconds.toFixed(1)}s)`,
  )
  .join('\n')}

CANDIDATE JOB MATCH (sample)
${verification.matchResults
  .map(
    (r) =>
      `  ${r.email}: ${r.matches} matches ${JSON.stringify(r.labels)} generated=${r.generated} (${r.seconds.toFixed(1)}s)\n    ${r.titles.join(' | ')}`,
  )
  .join('\n')}

MY APPLICATIONS (power applicant ${plan.powerApplicantEmail})
  total=${verification.listing.total} pages=${verification.listing.totalPages} limit=${verification.listing.limit}

TEST ACCOUNTS  (password: ${SYNTHETIC_PASSWORD})
  candidate (many applications)  ${plan.powerApplicantEmail}
  candidate (regular)            candidate005@example.test
  candidate (Korean, backend)    candidate004@example.test
  candidate (Uzbek, devops)      candidate013@example.test
  organization OWNER             owner001@example.test  (${plan.orgs[0]!.slug})
  organization RECRUITER         recruiter001@example.test

TIMINGS
${timings.report()}
================================================================
`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
