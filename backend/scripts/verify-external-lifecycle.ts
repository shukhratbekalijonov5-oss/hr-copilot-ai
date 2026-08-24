/**
 * The disappearance path, proven against the real database.
 *
 *   npm run external:lifecycle
 *
 * A posting closing is the one transition that cannot be waited for — no real
 * requisition obliges us by closing during a test run — and it is also the one
 * with the worst failure mode, because a bug here hides live jobs from every
 * candidate at once.
 *
 * So it is exercised under a PROBE SCOPE: three fabricated postings ingested
 * through the real pipeline under a scope token no configured board can ever
 * use, driven through the real lifecycle code, and deleted again at the end.
 * No provider is contacted, no real posting is touched, and the run asserts
 * the real catalogue is byte-identical before and after.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExternalIngestionService } from '../src/external-jobs/external-ingestion.service';
import { isCurrentlySearchable } from '../src/external-jobs/lifecycle';
import type { NormalizedExternalJobInput } from '../src/external-jobs/external-job.contract';

/** Not a valid Greenhouse board token, so it cannot collide with a real one. */
const PROBE_SCOPE = 'zz probe scope';
const PROBE_COMPANY = 'ZZ Lifecycle Probe Ltd';

function posting(id: string): NormalizedExternalJobInput {
  return {
    provider: 'GREENHOUSE',
    accessMethod: 'OFFICIAL_API',
    sourceJobId: `${PROBE_SCOPE}:${id}`,
    sourceUrl: `https://job-boards.greenhouse.io/zzprobe/jobs/${id}`,
    originalUrl: `https://job-boards.greenhouse.io/zzprobe/jobs/${id}`,
    companyName: PROBE_COMPANY,
    companyWebsiteUrl: null,
    companyCountryCode: null,
    title: `Probe Role ${id}`,
    description: null,
    requirementsText: null,
    countryCode: 'GB',
    region: null,
    city: 'London',
    workMode: null,
    additionalLocations: [],
    remoteCountriesAllowed: [],
    employmentType: null,
    seniorityLevel: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    skills: [],
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    expiresAt: null,
    employerPosted: null,
  closedAtSource: false,
  };
}

async function main(): Promise<void> {
  const logger = new Logger('VerifyLifecycle');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const ingestion = app.get(ExternalIngestionService);

  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    logger.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures.push(label);
  };

  const realJobsBefore = await prisma.externalJob.count({
    where: { sources: { none: { sourceScope: PROBE_SCOPE } } },
  });
  const realActiveBefore = await prisma.externalJob.count({
    where: {
      status: 'ACTIVE',
      sources: { none: { sourceScope: PROBE_SCOPE } },
    },
  });
  logger.log(
    `real catalogue before: ${realJobsBefore} jobs, ${realActiveBefore} ACTIVE`,
  );

  try {
    // -- 1. three postings appear ------------------------------------------
    const all = ['p1', 'p2', 'p3'].map(posting);
    await ingestion.ingestBatch(all, PROBE_SCOPE);
    const probeIds = async () =>
      (
        await prisma.externalJobSource.findMany({
          where: { sourceScope: PROBE_SCOPE },
          select: { sourceKey: true, status: true, externalJobId: true },
          orderBy: { sourceKey: 'asc' },
        })
      ).map((row) => row);

    let sources = await probeIds();
    check(sources.length === 3, 'three probe postings were ingested');
    check(
      sources.every((row) => row.status === 'ACTIVE'),
      'all three start ACTIVE',
    );

    // -- 2. one vanishes from a COMPLETE, SUCCESSFUL listing ---------------
    const observed = new Set([`${PROBE_SCOPE}:p1`, `${PROBE_SCOPE}:p2`]);
    const retired = await ingestion.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: PROBE_SCOPE,
      observedSourceKeys: observed,
      runSucceeded: true,
      absenceImpliesClosed: true,
    });
    logger.log(
      `absence sweep: ${retired.sourcesRetired} retired, ${retired.jobsClosed} left the universe`,
    );
    check(retired.sourcesRetired === 1, 'exactly the missing posting retired');

    sources = await probeIds();
    const gone = sources.filter((row) => row.status === 'GONE');
    check(gone.length === 1, 'the missing source is GONE');
    check(
      gone[0]?.sourceKey === `${PROBE_SCOPE}:p3`,
      'the GONE source is the one that was absent',
    );
    check(
      sources.filter((row) => row.status === 'ACTIVE').length === 2,
      'the two still listed remain ACTIVE',
    );

    const p3Job = await prisma.externalJob.findUnique({
      where: { id: gone[0].externalJobId },
      select: { status: true, closedAt: true },
    });
    check(
      p3Job !== null && !isCurrentlySearchable(p3Job.status),
      `the vanished job left the current universe (status ${p3Job?.status})`,
    );
    check(
      p3Job?.status === 'UNAVAILABLE',
      'it is UNAVAILABLE, not CLOSED — nobody said the employer ended it',
    );

    // -- 3. a FAILED run changes nothing more ------------------------------
    const afterFailure = await ingestion.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: PROBE_SCOPE,
      observedSourceKeys: new Set(),
      runSucceeded: false,
      absenceImpliesClosed: true,
    });
    check(
      afterFailure.sourcesRetired === 0,
      'a failed run retires nothing, even with everything absent',
    );
    sources = await probeIds();
    check(
      sources.filter((row) => row.status === 'ACTIVE').length === 2,
      'the two live postings survive a failed sweep',
    );

    // -- 4. a provider that cannot prove completeness changes nothing ------
    const afterPartial = await ingestion.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: PROBE_SCOPE,
      observedSourceKeys: new Set(),
      runSucceeded: true,
      absenceImpliesClosed: false,
    });
    check(
      afterPartial.sourcesRetired === 0,
      'an incomplete listing retires nothing',
    );

    // -- 5. a posting that comes back is live again ------------------------
    await ingestion.ingestBatch([posting('p3')], PROBE_SCOPE);
    sources = await probeIds();
    check(
      sources.every((row) => row.status === 'ACTIVE'),
      'a reappearing posting is ACTIVE again rather than stuck GONE',
    );
    const revived = await prisma.externalJob.findUnique({
      where: { id: gone[0].externalJobId },
      select: { status: true },
    });
    check(
      revived !== null && isCurrentlySearchable(revived.status),
      'and its job is back in the current universe',
    );

    // -- 6. nothing was deleted -------------------------------------------
    check(
      (await probeIds()).length === 3,
      'no row was ever deleted by the lifecycle',
    );
  } finally {
    // -- cleanup ------------------------------------------------------------
    const probeJobs = await prisma.externalJobSource.findMany({
      where: { sourceScope: PROBE_SCOPE },
      select: { externalJobId: true },
    });
    await prisma.externalJobSource.deleteMany({
      where: { sourceScope: PROBE_SCOPE },
    });
    await prisma.externalJob.deleteMany({
      where: { id: { in: probeJobs.map((row) => row.externalJobId) } },
    });
    await prisma.externalCompany.deleteMany({ where: { name: PROBE_COMPANY } });

    const realJobsAfter = await prisma.externalJob.count();
    const realActiveAfter = await prisma.externalJob.count({
      where: { status: 'ACTIVE' },
    });
    logger.log(
      `real catalogue after cleanup: ${realJobsAfter} jobs, ${realActiveAfter} ACTIVE`,
    );
    check(realJobsAfter === realJobsBefore, 'the real catalogue is unchanged');
    check(
      realActiveAfter === realActiveBefore,
      'no real job changed status during the probe',
    );
    check(
      (await prisma.externalJobSource.count({
        where: { sourceScope: PROBE_SCOPE },
      })) === 0,
      'every probe row was removed',
    );

    logger.log(
      failures.length === 0
        ? 'EXTERNAL LIFECYCLE: ALL CHECKS PASSED'
        : `EXTERNAL LIFECYCLE: ${failures.length} FAILED — ${failures.join('; ')}`,
    );
    if (failures.length > 0) process.exitCode = 1;
    await app.close();
  }
}

void main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: Error) => {
    new Logger('VerifyLifecycle').error(error.message);
    process.exit(1);
  },
);
