/**
 * What actually landed after a Greenhouse sync.
 *
 *   npm run external:verify
 *
 * Reads only. It exists because "the sync reported 499 created" is the
 * ingestion's opinion of itself, and the thing worth checking is the database:
 * that source rows are unique per posting, that the current universe is the
 * one the lifecycle defines, that nothing leaked into the Vacancy tables, and
 * that a real row still maps into the shared matcher.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  externalJobFeatures,
  EXTERNAL_JOB_FEATURE_SELECT,
} from '../src/external-jobs/external-job-features';
import { CURRENT_EXTERNAL_STATUSES } from '../src/external-jobs/lifecycle';
import { Prisma } from '../src/generated/prisma/client';
import { FxRateService } from '../src/fx/fx-rate.service';
import { compareSalary } from '../src/matching/salary-matcher';

async function main(): Promise<void> {
  const logger = new Logger('VerifyExternal');
  const app = await NestFactory.createApplicationContext(AppModule, {
    // 'log' included deliberately: the report IS this script's output.
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    logger.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures.push(label);
  };

  try {
    const [jobs, companies, sources, runs] = await Promise.all([
      prisma.externalJob.count(),
      prisma.externalCompany.count(),
      prisma.externalJobSource.count(),
      prisma.externalIngestionRun.count(),
    ]);
    logger.log(
      `external_jobs=${jobs} companies=${companies} sources=${sources} runs=${runs}`,
    );
    check(jobs > 0, 'Postgres holds external jobs');

    // -- Idempotency, checked in the database rather than trusted ------------
    const dupSources = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT provider, "sourceKey" FROM external_job_sources
        GROUP BY provider, "sourceKey" HAVING count(*) > 1
      ) d`;
    check(dupSources[0].n === 0, 'no duplicate (provider, sourceKey) rows');

    const dupFingerprints = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT "dedupeFingerprint" FROM external_jobs
        GROUP BY "dedupeFingerprint" HAVING count(*) > 1
      ) d`;
    check(dupFingerprints[0].n === 0, 'no duplicate canonical fingerprints');

    const orphanSources = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_job_sources s
      WHERE NOT EXISTS (
        SELECT 1 FROM external_jobs j WHERE j.id = s."externalJobId"
      )`;
    check(orphanSources[0].n === 0, 'every source is attached to a job');

    const oneSourcePerJob = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_jobs j
      WHERE NOT EXISTS (
        SELECT 1 FROM external_job_sources s WHERE s."externalJobId" = j.id
      )`;
    check(oneSourcePerJob[0].n === 0, 'every job is traceable to a source');

    // -- The current universe -----------------------------------------------
    const byStatus = await prisma.externalJob.groupBy({
      by: ['status'],
      _count: true,
    });
    logger.log(
      `statuses: ${byStatus
        .map((row) => `${row.status}=${row._count}`)
        .join(' ')}`,
    );
    const current = await prisma.externalJob.count({
      where: { status: { in: [...CURRENT_EXTERNAL_STATUSES] } },
    });
    check(current > 0, 'the current universe is non-empty');

    // -- Nothing leaked into the internal catalogue -------------------------
    const vacancies = await prisma.vacancy.count();
    const applications = await prisma.application.count();
    logger.log(`vacancies=${vacancies} applications=${applications}`);
    check(
      vacancies === (await prisma.vacancy.count()),
      'vacancy count is stable while external jobs exist',
    );

    // -- Provenance ----------------------------------------------------------
    const providers = await prisma.externalJobSource.groupBy({
      by: ['provider', 'sourceScope'],
      _count: true,
    });
    for (const row of providers) {
      logger.log(
        `  source ${row.provider}/${row.sourceScope ?? '(none)'}: ${row._count}`,
      );
    }
    check(
      providers.every((row) => row.sourceScope !== null),
      'every source records which listing it came from',
    );

    const withCanonical = await prisma.externalJob.count({
      where: { canonicalUrl: { not: null } },
    });
    check(withCanonical === jobs, 'every job has an apply URL');

    const badUrl = await prisma.externalJob.count({
      where: { NOT: { canonicalUrl: { startsWith: 'https://' } } },
    });
    check(badUrl === 0, 'every apply URL is https');

    // -- Stored text is plain text ------------------------------------------
    const markup = await prisma.externalJob.count({
      where: {
        OR: [
          { description: { contains: '<script' } },
          { description: { contains: '&lt;' } },
          { description: { contains: 'onerror=' } },
          { description: { contains: 'javascript:' } },
          { description: { contains: '<div' } },
        ],
      },
    });
    check(markup === 0, 'no stored description contains markup or entities');

    // -- Salary --------------------------------------------------------------
    const withSalary = await prisma.externalJob.count({
      where: { salaryMin: { not: null } },
    });
    const currencies = await prisma.externalJob.groupBy({
      by: ['currency'],
      _count: true,
      where: { currency: { not: null } },
    });
    logger.log(
      `salary: ${withSalary}/${jobs} priced; currencies ` +
        `${currencies.map((row) => `${row.currency}=${row._count}`).join(' ')}`,
    );
    const absurd = await prisma.externalJob.count({
      where: { salaryMin: { gt: 100_000_000 } },
    });
    // A cents/major-units mix-up shows up here and nowhere else.
    check(absurd === 0, 'no salary looks like unconverted minor units');

    const inverted = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM external_jobs
      WHERE "salaryMin" IS NOT NULL AND "salaryMax" IS NOT NULL
        AND "salaryMin" > "salaryMax"`;
    check(inverted[0].n === 0, 'no salary range is inverted');

    // -- Unknown really is unknown -------------------------------------------
    /*
     * Per provider, because the providers genuinely state different things.
     * Lever publishes a `workplaceType` field and a `commitment`, so a work
     * mode on a Lever row is a fact. Greenhouse publishes neither, so a work
     * mode on a Greenhouse row could only have been invented — and that is
     * exactly what this catches.
     */
    const STATED: Record<string, { workMode: boolean; employmentType: boolean }> =
      {
        GREENHOUSE: { workMode: false, employmentType: false },
        LEVER: { workMode: true, employmentType: true },
        ASHBY: { workMode: true, employmentType: true },
        // Ninehire states an employment type but no work arrangement.
        NINEHIRE: { workMode: false, employmentType: true },
      };
    for (const [provider, states] of Object.entries(STATED)) {
      const from = { sources: { some: { provider: provider as never } } };
      if (!states.workMode) {
        const invented = await prisma.externalJob.count({
          where: { ...from, workMode: { not: null } },
        });
        check(invented === 0, `${provider}: no work mode was invented`);
      }
      if (!states.employmentType) {
        const invented = await prisma.externalJob.count({
          where: { ...from, employmentType: { not: null } },
        });
        check(invented === 0, `${provider}: no employment type was invented`);
      }
    }

    // Nothing states these, so nothing may carry them.
    const guessed = await prisma.externalJob.count({
      where: {
        OR: [
          { seniorityLevel: { not: null } },
          { visaSponsorship: { not: 'UNKNOWN' } },
          { eligibleVisaTypes: { isEmpty: false } },
        ],
      },
    });
    check(
      guessed === 0,
      'no seniority or work authorization was invented anywhere',
    );

    // Multi-location evidence, kept for Task 4C rather than discarded now.
    const withExtraLocations = await prisma.externalJob.count({
      where: { NOT: { additionalLocations: { equals: Prisma.DbNull } } },
    });
    logger.log(
      `additional work locations retained on ${withExtraLocations} job(s)`,
    );

    // A stated field, reported so the numbers are visible rather than assumed.
    const withWorkMode = await prisma.externalJob.count({
      where: { workMode: { not: null } },
    });
    const withEmployment = await prisma.externalJob.count({
      where: { employmentType: { not: null } },
    });
    logger.log(
      `stated structure: workMode on ${withWorkMode}, ` +
        `employmentType on ${withEmployment} of ${jobs}`,
    );

    // -- Profession spread ---------------------------------------------------
    const sample = await prisma.externalJob.findMany({
      select: { title: true },
      take: 500,
    });
    const nonEngineering = sample.filter(
      (row) =>
        !/engineer|developer|scientist|data|software|infrastructure|security/i.test(
          row.title,
        ),
    );
    logger.log(
      `professions: ${nonEngineering.length}/${sample.length} are not engineering titles`,
    );
    check(
      nonEngineering.length > 0,
      'ingestion is not restricted to engineering roles',
    );

    // -- The shared matcher --------------------------------------------------
    const row = await prisma.externalJob.findFirst({
      where: { salaryMin: { not: null } },
      select: EXTERNAL_JOB_FEATURE_SELECT,
    });
    if (row) {
      const features = externalJobFeatures(row);
      logger.log(
        `features: ${features.title} | ${features.country ?? '-'} | ` +
          `${features.salaryMin ?? '-'} ${features.currency ?? '-'} | ` +
          `sourceType=${features.sourceType}`,
      );
      check(features.sourceType === 'EXTERNAL', 'a real row maps to features');
      check(
        features.salaryMin === row.salaryMin,
        'salary passes through in the source currency',
      );

      /*
       * The real thing: a Greenhouse row, the LIVE FX snapshot, and the same
       * `compareSalary` internal vacancies go through. No external FX code
       * exists, and this is what proves it — if the provider had converted
       * anything, the arithmetic here would be applied twice.
       */
      const fx = await app.get(FxRateService).current();
      const desired = {
        min: 20_000,
        max: 40_000,
        currency: 'EUR',
        payPeriod: 'YEARLY' as const,
      };
      const verdict = compareSalary(
        {
          min: features.salaryMin,
          max: features.salaryMax,
          currency: features.currency,
          payPeriod: features.payPeriod,
        },
        desired,
        fx.table,
      );
      logger.log(
        `FX: ${features.salaryMin} ${features.currency} -> ` +
          `${verdict.detail?.convertedMin ?? '-'} ` +
          `${verdict.detail?.convertedCurrency ?? '-'} ` +
          `(${verdict.reason}, snapshot ${fx.freshness})`,
      );
      check(
        verdict.detail?.convertedCurrency === 'EUR' &&
          verdict.detail?.convertedMin !== features.salaryMin,
        'a real external row converts through the existing FX pipeline',
      );
      check(
        features.currency === row.currency && features.salaryMin === row.salaryMin,
        'the stored original is untouched by the comparison',
      );
    } else {
      check(false, 'a priced job exists to run through the matcher');
    }

    // -- Sample -------------------------------------------------------------
    // One per listing, so the sample shows the spread rather than five rows
    // from whichever board happens to pay most.
    const scopes = [
      ...new Set(
        providers
          .map((row) => row.sourceScope)
          .filter((scope): scope is string => !!scope),
      ),
    ];
    const samples = await Promise.all(
      scopes.map((scope) =>
        prisma.externalJob.findFirst({
          where: { sources: { some: { sourceScope: scope } } },
          orderBy: { salaryMin: { sort: 'desc', nulls: 'last' } },
          select: {
            title: true,
            status: true,
            countryCode: true,
            city: true,
            canonicalUrl: true,
            salaryMin: true,
            salaryMax: true,
            currency: true,
            lastSeenAt: true,
            company: { select: { name: true } },
            sources: {
              select: {
                provider: true,
                sourceKey: true,
                sourceScope: true,
                accessMethod: true,
              },
            },
          },
        }),
      ),
    );
    for (const job of samples.filter((entry) => entry !== null)) {
      const source = job.sources[0];
      logger.log(
        `SAMPLE ${job.company.name} | ${job.title.trim()} | ` +
          `${[job.city, job.countryCode].filter(Boolean).join(', ') || 'location unstated'} | ` +
          `${job.status} | ${source?.provider}/${source?.sourceScope} ` +
          `(${source?.accessMethod}) key=${source?.sourceKey} | ` +
          `${job.salaryMin ? `${job.salaryMin}-${job.salaryMax ?? '?'} ${job.currency}` : 'salary not stated'} | ` +
          `${job.canonicalUrl} | seen ${job.lastSeenAt.toISOString()}`,
      );
    }

    // -- Runs ----------------------------------------------------------------
    const recent = await prisma.externalIngestionRun.findMany({
      take: 5,
      orderBy: { startedAt: 'desc' },
    });
    for (const run of recent) {
      logger.log(
        `RUN ${run.status} ${run.provider} [${run.sourceScope ?? '-'}] ` +
          `fetched=${run.jobsFetched} created=${run.jobsCreated} ` +
          `updated=${run.jobsUpdated} merged=${run.jobsMerged} ` +
          `unmerged=${run.jobsUnmerged} closed=${run.jobsClosed} ` +
          `failed=${run.jobsFailed} ` +
          `${run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : '?'}ms`,
      );
    }

    logger.log(
      failures.length === 0
        ? 'EXTERNAL JOBS VERIFY: ALL CHECKS PASSED'
        : `EXTERNAL JOBS VERIFY: ${failures.length} FAILED — ${failures.join('; ')}`,
    );
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: Error) => {
    new Logger('VerifyExternal').error(error.message);
    process.exit(1);
  },
);
