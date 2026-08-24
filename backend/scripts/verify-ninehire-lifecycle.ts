/**
 * Ninehire ingestion and lifecycle, end to end, against the real database.
 *
 *   npm run external:ninehire-lifecycle
 *
 * ## Why this is driven by a controlled provider rather than a live workspace
 *
 * Ninehire's API is authenticated per workspace and no authorized credential
 * is configured on this machine. Reaching a real workspace would mean
 * obtaining somebody else's key, which is the unauthorized access this whole
 * provider is built to make impossible — so the responses here are the
 * officially documented shapes, served locally, and everything downstream of
 * the HTTP boundary is the real thing: the real provider class, the real
 * normalizer, the real ingestion, the real dedupe and the real lifecycle.
 *
 * What that proves is everything except "the live API returns what its docs
 * say". What it cannot prove is stated plainly in the report rather than
 * implied away.
 *
 * Runs under a probe scope no real configuration can name, and deletes it.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExternalIngestionService } from '../src/external-jobs/external-ingestion.service';
import { NinehireProvider } from '../src/external-jobs/providers/ninehire/ninehire.provider';
import { isCurrentlySearchable } from '../src/external-jobs/lifecycle';
import type { ProviderResponse } from '../src/external-jobs/provider-http';

const PROBE_SCOPE = 'zzninehireprobe';
const PROBE_COMPANY = 'ZZ Ninehire Probe';
/** Obvious dummy. Valid nowhere. */
const PROBE_KEY = 'probe-not-a-real-key-0000';

function posting(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `백엔드 개발자 ${id}`,
    applyUrl: `https://career.ninehire.com/job_posting/${id}/apply`,
    deadline: null,
    tags: ['백엔드'],
    career: 'experienced',
    careerRange: { over: 3, below: 6 },
    employmentTypes: ['full_time'],
    jobLocations: [
      { x: 129.12, y: 35.17, name: '부산지사', address: '부산 해운대구 센텀중앙로 97' },
      { name: '본사', address: '서울 강남구 테헤란로 123' },
    ],
    jobGroup: '개발팀',
    jobTask: '백엔드',
    affiliation: '나인하이어',
    createdAt: '2026-01-05T00:00:00.000Z',
    isPrivate: false,
    status: 'in_progress',
    ...over,
  };
}

/** A provider whose workspace contents this script decides. */
function probeProvider(config: ConfigService, jobs: unknown[]): NinehireProvider {
  const handler = (url: string): ProviderResponse => {
    const body = /\/jobs\/[^?]+/.test(url)
      ? {
          ...posting(url.split('/jobs/')[1].split('?')[0]),
          content:
            '<p>백엔드 서비스를 함께 만들어 갈 동료를 찾습니다.</p>' +
            '<script>alert(1)</script>',
        }
      : { count: jobs.length, results: jobs };
    return {
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(body)),
    };
  };
  return new NinehireProvider(
    {
      get: (key: string, fallback?: unknown) => {
        if (key === 'externalJobs.ninehireSources')
          return `${PROBE_SCOPE}:NINEHIRE_PROBE_KEY`;
        if (key === 'NINEHIRE_PROBE_KEY') return PROBE_KEY;
        return config.get(key, fallback as never);
      },
    } as unknown as ConfigService,
    (url) => Promise.resolve(handler(url)),
    () => Promise.resolve(),
  );
}

async function main(): Promise<void> {
  const logger = new Logger('VerifyNinehire');
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
    where: { sources: { none: { sourceScope: PROBE_SCOPE } } },
  });
  const realActiveBefore = await prisma.externalJob.count({
    where: { status: 'ACTIVE', sources: { none: { sourceScope: PROBE_SCOPE } } },
  });
  logger.log(`real catalogue before: ${realBefore} jobs, ${realActiveBefore} ACTIVE`);

  const probeSources = () =>
    prisma.externalJobSource.findMany({
      where: { sourceScope: PROBE_SCOPE },
      select: { sourceKey: true, status: true, externalJobId: true },
      orderBy: { sourceKey: 'asc' },
    });

  const ingest = async (jobs: unknown[]) => {
    const provider = probeProvider(config, jobs);
    const page = await provider.fetchPage(null);
    await ingestion.ingestBatch(page.jobs, PROBE_SCOPE);
    return page;
  };

  const retire = async (observed: string[], runSucceeded = true) =>
    ingestion.markAbsent({
      provider: 'NINEHIRE',
      scopeKey: PROBE_SCOPE,
      observedSourceKeys: new Set(observed),
      runSucceeded,
      absenceImpliesClosed: true,
    });

  try {
    // -- 1. four postings: public, private, disabled, closed ---------------
    const first = await ingest([
      posting('p1'),
      posting('p2', { isPrivate: true }),
      posting('p3', { status: 'disabled' }),
      posting('p4', { status: 'closed' }),
    ]);

    check(first.complete === true, 'a single-request workspace is a complete snapshot');
    check(
      first.jobs.map((job) => job.sourceJobId).sort().join(',') ===
        `${PROBE_SCOPE}:p1,${PROBE_SCOPE}:p4`,
      'only in_progress and closed postings are ingested',
    );
    check(
      !first.jobs.some((job) => job.sourceJobId === `${PROBE_SCOPE}:p2`),
      'the PRIVATE posting is never candidate-searchable',
    );
    check(
      !first.jobs.some((job) => job.sourceJobId === `${PROBE_SCOPE}:p3`),
      'a disabled posting is not listed',
    );

    // -- 2. Korean data survived --------------------------------------------
    const stored = await prisma.externalJob.findFirst({
      where: { sources: { some: { sourceKey: `${PROBE_SCOPE}:p1` } } },
      select: {
        title: true,
        countryCode: true,
        region: true,
        city: true,
        additionalLocations: true,
        description: true,
        salaryMin: true,
        currency: true,
        seniorityLevel: true,
        employmentType: true,
        status: true,
      },
    });
    check(stored?.title === '백엔드 개발자 p1', 'the Korean title is stored verbatim');
    check(stored?.countryCode === 'KR', 'a Korean address resolves to KR');
    check(stored?.region === '부산' && stored?.city === '해운대구',
      `the Korean region and city are stored as Korean (${stored?.region}/${stored?.city})`);
    const extra = (stored?.additionalLocations ?? []) as { region?: string }[];
    check(extra.length === 1 && extra[0]?.region === '서울',
      'the second work site is kept, not discarded');
    check(!!stored?.description?.includes('동료를 찾습니다'),
      'the Korean description is stored as plain text');
    check(!stored?.description?.includes('alert(1)'),
      'a script in the detail content does not survive');
    check(stored?.salaryMin === null && stored?.currency === null,
      'no salary is invented — the API exposes none');
    check(stored?.seniorityLevel === null,
      'career/careerRange did not become a seniority level');
    check(stored?.employmentType === 'FULL_TIME', 'a single employment type maps');

    // -- 3. explicit closure -------------------------------------------------
    const closed = await prisma.externalJob.findFirst({
      where: { sources: { some: { sourceKey: `${PROBE_SCOPE}:p4` } } },
      select: { status: true },
    });
    check(closed?.status === 'CLOSED',
      `an explicitly closed posting is CLOSED, not UNAVAILABLE (got ${closed?.status})`);

    // -- 4. idempotency ------------------------------------------------------
    const before = await probeSources();
    await ingest([posting('p1'), posting('p4', { status: 'closed' })]);
    const after = await probeSources();
    check(after.length === before.length, 'a second sync creates no duplicate source');

    // -- 5. public → private is a delisting, not a closure -------------------
    await ingest([posting('p4', { status: 'closed' })]);
    const retired = await retire([`${PROBE_SCOPE}:p4`]);
    check(retired.sourcesRetired === 1, 'the now-private posting was retired');
    const goneJob = await prisma.externalJob.findFirst({
      where: { sources: { some: { sourceKey: `${PROBE_SCOPE}:p1` } } },
      select: { status: true },
    });
    check(goneJob?.status === 'UNAVAILABLE',
      `a posting turned private becomes UNAVAILABLE, not CLOSED (got ${goneJob?.status})`);
    check(
      goneJob !== null && !isCurrentlySearchable(goneJob.status),
      'and it leaves the candidate-searchable universe',
    );

    // -- 6. an auth failure retires nothing ---------------------------------
    const afterAuthFailure = await retire([], false);
    check(afterAuthFailure.sourcesRetired === 0,
      'a failed run (401/403/outage) retires nothing, even with everything absent');

    // -- 7. EXPIRED, from the employer's own deadline ------------------------
    await ingest([posting('p5', { deadline: '2023-02-28T00:00:00.905Z' })]);
    const expired = await prisma.externalJob.findFirst({
      where: { sources: { some: { sourceKey: `${PROBE_SCOPE}:p5` } } },
      select: { status: true, expiresAt: true },
    });
    check(expired?.expiresAt !== null, 'the stated deadline is stored');
    check(expired?.status === 'EXPIRED',
      `a passed deadline yields EXPIRED (got ${expired?.status})`);
    check(
      expired !== null && !isCurrentlySearchable(expired.status),
      'and the expired job leaves the current universe',
    );

    await ingest([posting('p6', { deadline: '2030-01-01T00:00:00.000Z' })]);
    const future = await prisma.externalJob.findFirst({
      where: { sources: { some: { sourceKey: `${PROBE_SCOPE}:p6` } } },
      select: { status: true },
    });
    check(future?.status === 'ACTIVE', 'a future deadline leaves the job ACTIVE');

    await ingest([posting('p7', { deadline: null })]);
    const rolling = await prisma.externalJob.findFirst({
      where: { sources: { some: { sourceKey: `${PROBE_SCOPE}:p7` } } },
      select: { status: true, expiresAt: true },
    });
    check(rolling?.expiresAt === null && rolling?.status === 'ACTIVE',
      '상시 채용 — a null deadline never expires');

    // -- 8. a reappearing posting comes back --------------------------------
    await ingest([posting('p1')]);
    const revived = await prisma.externalJob.findFirst({
      where: { sources: { some: { sourceKey: `${PROBE_SCOPE}:p1` } } },
      select: { status: true },
    });
    check(revived?.status === 'ACTIVE', 'a re-listed posting is ACTIVE again');

    check((await probeSources()).length >= 5, 'no row was ever deleted by the lifecycle');
  } finally {
    const probeJobs = await prisma.externalJobSource.findMany({
      where: { sourceScope: PROBE_SCOPE },
      select: { externalJobId: true },
    });
    await prisma.externalJobSource.deleteMany({ where: { sourceScope: PROBE_SCOPE } });
    await prisma.externalJob.deleteMany({
      where: { id: { in: probeJobs.map((row) => row.externalJobId) } },
    });
    await prisma.externalCompany.deleteMany({ where: { name: PROBE_COMPANY } });
    await prisma.externalCompany.deleteMany({ where: { name: PROBE_SCOPE } });

    const realAfter = await prisma.externalJob.count();
    const realActiveAfter = await prisma.externalJob.count({
      where: { status: 'ACTIVE' },
    });
    logger.log(
      `real catalogue after cleanup: ${realAfter} jobs, ${realActiveAfter} ACTIVE`,
    );
    check(realAfter === realBefore, 'the real catalogue is unchanged');
    check(realActiveAfter === realActiveBefore, 'no real job changed status');
    check(
      (await prisma.externalJobSource.count({
        where: { sourceScope: PROBE_SCOPE },
      })) === 0,
      'every probe row was removed',
    );

    logger.log(
      failures.length === 0
        ? 'NINEHIRE LIFECYCLE: ALL CHECKS PASSED'
        : `NINEHIRE LIFECYCLE: ${failures.length} FAILED — ${failures.join('; ')}`,
    );
    if (failures.length > 0) process.exitCode = 1;
    await app.close();
  }
}

void main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: Error) => {
    new Logger('VerifyNinehire').error(error.message);
    process.exit(1);
  },
);
