/**
 * What happens when an Ashby posting stops being listed.
 *
 *   npm run external:ashby-listing
 *
 * `isListed: false` means "reachable by direct link but not to be shown in a
 * public listing". No live board returned one while this was built — all 334
 * postings across four boards were listed — so the transition is driven here
 * with a controlled provider whose responses have the official shape, against
 * the real ingestion, dedupe and lifecycle code.
 *
 * The point is to prove the delisting is handled by the GENERIC lifecycle and
 * needed no Ashby-only status: a delisted posting simply stops appearing in a
 * complete snapshot, and the existing absence rule retires that source as GONE
 * — "the source stopped listing it" — rather than CLOSED, which would claim
 * the employer ended a role they may still be quietly hiring for.
 *
 * Everything runs under a probe board no real configuration can name, and is
 * deleted afterwards. No real posting is touched.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExternalIngestionService } from '../src/external-jobs/external-ingestion.service';
import { AshbyProvider } from '../src/external-jobs/providers/ashby/ashby.provider';
import { isCurrentlySearchable } from '../src/external-jobs/lifecycle';
import type { ProviderResponse } from '../src/external-jobs/provider-http';

const PROBE_BOARD = 'zzlistingprobe';
const PROBE_COMPANY = 'ZZ Listing Probe Ltd';

function posting(id: string, isListed: boolean) {
  return {
    id,
    title: `Probe Role ${id}`,
    employmentType: 'FullTime',
    workplaceType: 'OnSite',
    isListed,
    address: {
      postalAddress: {
        addressLocality: 'London',
        addressRegion: 'England',
        addressCountry: 'United Kingdom',
      },
    },
    descriptionPlain:
      'We are hiring for a probe role on the London team for this test.',
    jobUrl: `https://jobs.ashbyhq.com/${PROBE_BOARD}/${id}`,
    applyUrl: `https://jobs.ashbyhq.com/${PROBE_BOARD}/${id}/application`,
  };
}

/** A provider whose board contents this script decides, shape-for-shape. */
function probeProvider(config: ConfigService, jobs: unknown[]): AshbyProvider {
  const respond = (): ProviderResponse => ({
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify({ apiVersion: 1, jobs })),
  });
  return new AshbyProvider(
    {
      get: (key: string, fallback?: unknown) =>
        key === 'externalJobs.ashbyBoards'
          ? `${PROBE_BOARD}:${PROBE_COMPANY}`
          : config.get(key, fallback as never),
    } as unknown as ConfigService,
    () => Promise.resolve(respond()),
  );
}

async function main(): Promise<void> {
  const logger = new Logger('VerifyAshbyListing');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const ingestion = app.get(ExternalIngestionService);
  const config = app.get(ConfigService);

  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    logger.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures.push(label);
  };

  const realBefore = await prisma.externalJob.count({
    where: { sources: { none: { sourceScope: PROBE_BOARD } } },
  });
  const realActiveBefore = await prisma.externalJob.count({
    where: { status: 'ACTIVE', sources: { none: { sourceScope: PROBE_BOARD } } },
  });
  logger.log(`real catalogue before: ${realBefore} jobs, ${realActiveBefore} ACTIVE`);

  const probeSources = () =>
    prisma.externalJobSource.findMany({
      where: { sourceScope: PROBE_BOARD },
      select: { sourceKey: true, status: true, externalJobId: true },
      orderBy: { sourceKey: 'asc' },
    });

  try {
    // -- 1. two listed postings arrive --------------------------------------
    const listed = probeProvider(config, [
      posting('p1', true),
      posting('p2', true),
    ]);
    const first = await listed.fetchPage(null);
    check(first.jobs.length === 2, 'both listed postings were normalized');
    check(first.complete === true, 'a well-formed snapshot is complete');
    await ingestion.ingestBatch(first.jobs, PROBE_BOARD);

    let sources = await probeSources();
    check(sources.length === 2, 'both were ingested');
    check(
      sources.every((row) => row.status === 'ACTIVE'),
      'both start ACTIVE and candidate-listable',
    );

    // -- 2. one becomes unlisted -------------------------------------------
    const delisted = probeProvider(config, [
      posting('p1', true),
      // Still returned by the API, and deliberately not for public listing.
      posting('p2', false),
    ]);
    const second = await delisted.fetchPage(null);
    check(
      second.jobs.length === 1 &&
        second.jobs[0].sourceJobId === `${PROBE_BOARD}:p1`,
      'the unlisted posting never reaches ingestion',
    );
    check(
      second.rejected.length === 0,
      'an unlisted posting is an exclusion, not a rejection',
    );
    check(
      second.complete === true,
      'excluding it does not make the snapshot incomplete',
    );

    await ingestion.ingestBatch(second.jobs, PROBE_BOARD);
    const retired = await ingestion.markAbsent({
      provider: 'ASHBY',
      scopeKey: PROBE_BOARD,
      observedSourceKeys: new Set(
        second.jobs.map((job) => job.sourceJobId!).filter(Boolean),
      ),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });
    check(retired.sourcesRetired === 1, 'exactly the delisted source retired');

    sources = await probeSources();
    const gone = sources.find((row) => row.status !== 'ACTIVE');
    check(gone?.sourceKey === `${PROBE_BOARD}:p2`, 'it is the delisted one');
    check(
      gone?.status === 'GONE',
      'the SOURCE is GONE — it stopped listing the posting',
    );

    const job = await prisma.externalJob.findUnique({
      where: { id: gone!.externalJobId },
      select: { status: true },
    });
    check(
      job?.status === 'UNAVAILABLE',
      `the JOB is UNAVAILABLE, not CLOSED (got ${job?.status})`,
    );
    check(
      job !== null && !isCurrentlySearchable(job.status),
      'and it has left the candidate-searchable universe',
    );
    check(
      sources.filter((row) => row.status === 'ACTIVE').length === 1,
      'the still-listed posting is untouched',
    );

    // -- 3. nothing was deleted --------------------------------------------
    check(
      sources.length === 2,
      'the delisted posting is retained, not deleted — it may come back',
    );

    // -- 4. and it can come back -------------------------------------------
    const relisted = probeProvider(config, [
      posting('p1', true),
      posting('p2', true),
    ]);
    const third = await relisted.fetchPage(null);
    await ingestion.ingestBatch(third.jobs, PROBE_BOARD);
    sources = await probeSources();
    check(
      sources.every((row) => row.status === 'ACTIVE'),
      'a re-listed posting is ACTIVE again rather than stuck GONE',
    );
  } finally {
    const probeJobs = await prisma.externalJobSource.findMany({
      where: { sourceScope: PROBE_BOARD },
      select: { externalJobId: true },
    });
    await prisma.externalJobSource.deleteMany({
      where: { sourceScope: PROBE_BOARD },
    });
    await prisma.externalJob.deleteMany({
      where: { id: { in: probeJobs.map((row) => row.externalJobId) } },
    });
    await prisma.externalCompany.deleteMany({ where: { name: PROBE_COMPANY } });

    const realAfter = await prisma.externalJob.count();
    const realActiveAfter = await prisma.externalJob.count({
      where: { status: 'ACTIVE' },
    });
    logger.log(
      `real catalogue after cleanup: ${realAfter} jobs, ${realActiveAfter} ACTIVE`,
    );
    check(realAfter === realBefore, 'the real catalogue is unchanged');
    check(
      realActiveAfter === realActiveBefore,
      'no real job changed status during the probe',
    );
    check(
      (await prisma.externalJobSource.count({
        where: { sourceScope: PROBE_BOARD },
      })) === 0,
      'every probe row was removed',
    );

    logger.log(
      failures.length === 0
        ? 'ASHBY LISTING LIFECYCLE: ALL CHECKS PASSED'
        : `ASHBY LISTING LIFECYCLE: ${failures.length} FAILED — ${failures.join('; ')}`,
    );
    if (failures.length > 0) process.exitCode = 1;
    await app.close();
  }
}

void main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: Error) => {
    new Logger('VerifyAshbyListing').error(error.message);
    process.exit(1);
  },
);
