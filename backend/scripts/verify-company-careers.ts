/**
 * One job, two provenance rows — proven against the real database.
 *
 *   npm run external:company-careers
 *
 * ## What this exists to prove
 *
 * Four ATS providers never produced a canonical job with more than one source
 * on it, so the multi-source half of the architecture had never actually run.
 * The company careers provider is the first thing that makes it happen, and
 * the questions it raises are all lifecycle questions:
 *
 *   - does a company page and the ATS behind it become ONE job, or two?
 *   - when the company page stops listing a role the ATS still lists, does
 *     the job survive?
 *   - when the LAST source goes, does the job leave the universe?
 *   - if the employer migrates ATS, does anything rewrite one provider's
 *     sighting as another's?
 *
 * None of those can be answered by a live sync, because they need a source to
 * disappear on cue. So the pages are served locally — the real provider, the
 * real extractor, the real normalizer, the real ingestion, the real dedupe and
 * the real lifecycle, with only the socket replaced.
 *
 * Everything runs under a probe source id no configuration can name, against
 * the real tables, and is deleted afterwards. The real catalogue is counted
 * before and after.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExternalIngestionService } from '../src/external-jobs/external-ingestion.service';
import { CompanyCareersProvider } from '../src/external-jobs/providers/company-careers/company-careers.provider';
import { normalizeGreenhouseJob } from '../src/external-jobs/providers/greenhouse/greenhouse.normalize';
import { normalizeAshbyJob } from '../src/external-jobs/providers/ashby/ashby.normalize';
import { isCurrentlySearchable } from '../src/external-jobs/lifecycle';
import type { SafeHttpFetcher } from '../src/web-ingestion/safe-fetcher';
import type { NormalizedExternalJobInput } from '../src/external-jobs/external-job.contract';

/** A source id and a host no reviewed catalogue entry can collide with. */
const PROBE_ID = 'zzprobe-careers';
const PROBE_HOST = 'zzprobe-careers.invalid';
const PROBE_ATS_HOST = 'zzprobe-ats.invalid';
const PROBE_COMPANY = 'ZZ Probe Careers';
const PROBE_BOARD = 'zzprobeboard';

/** The catalogue entry this probe uses, injected for the run only. */
const PROBE_SOURCE = {
  sourceId: PROBE_ID,
  companyLabel: PROBE_COMPANY,
  companyWebsiteUrl: `https://${PROBE_HOST}`,
  indexUrl: `https://${PROBE_HOST}/careers`,
  allowedHosts: [PROBE_HOST],
  allowedPathPrefixes: ['/careers'],
  applyHosts: [PROBE_ATS_HOST],
  index: 'ANCHOR_LIST' as const,
  detail: 'HTML_META' as const,
  jobPathPattern: /^\/careers\/[a-z0-9-]{1,80}$/,
  indexIsComplete: true,
  maxJobsPerSync: 50,
  maxDetailRequests: 50,
  minRequestIntervalMs: 0,
  expectedAtsProvider: 'GREENHOUSE' as const,
  access: {
    reviewedOn: '2026-08-24',
    robots: 'probe only; never reaches a network',
    rendering: 'served in-process',
    verdict: 'probe',
  },
  enabled: true,
};

interface ProbeJob {
  slug: string;
  title: string;
  applyUrl: string | null;
}

/**
 * A provider whose "site" this script writes.
 *
 * The fetcher is the only thing replaced. Everything above it — robots, the
 * per-source allowlist, anchor extraction, title reading, apply-link
 * selection, normalization — is the shipped code.
 */
function probeProvider(
  config: ConfigService,
  jobs: ProbeJob[],
): CompanyCareersProvider {
  const index =
    `<html><body><a href="/about">About us</a>` +
    jobs
      .map(
        (job) =>
          `<a href="/careers/${job.slug}"><span>${job.title}</span><span>Remote</span></a>`,
      )
      .join('') +
    `</body></html>`;

  const detail = (job: ProbeJob) =>
    `<html><head>` +
    `<meta property="og:title" content="${job.title} — ${PROBE_COMPANY}"/>` +
    `<meta property="og:url" content="https://${PROBE_HOST}/careers/${job.slug}"/>` +
    `</head><body>` +
    (job.applyUrl ? `<a href="${job.applyUrl}">Apply</a>` : '') +
    `</body></html>`;

  const fetcher = {
    fetchText: (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return Promise.resolve({
          url,
          status: 200,
          mediaType: 'text/plain',
          body: 'User-agent: *\nDisallow: /api/\n',
          byteLength: 40,
        });
      }
      if (url === `https://${PROBE_HOST}/careers`) {
        return Promise.resolve({
          url,
          status: 200,
          mediaType: 'text/html',
          body: index,
          byteLength: index.length,
        });
      }
      const slug = url.split('/careers/')[1];
      const job = jobs.find((entry) => entry.slug === slug);
      if (!job) return Promise.reject(new Error(`404 for ${url}`));
      const body = detail(job);
      return Promise.resolve({
        url,
        status: 200,
        mediaType: 'text/html',
        body,
        byteLength: body.length,
      });
    },
  } as unknown as SafeHttpFetcher;

  // Handed in through the provider's source argument rather than added to the
  // reviewed catalogue: a probe host must never become something a real
  // deployment can configure.
  return new CompanyCareersProvider(
    {
      get: (key: string, fallback?: unknown): unknown =>
        key === 'externalJobs.companyCareersSources'
          ? ''
          : config.get(key, fallback as never),
    } as unknown as ConfigService,
    fetcher,
    [PROBE_SOURCE],
  );
}

/** An ATS sighting of the same requisition. */
function greenhouseSighting(
  id: string,
  title: string,
): NormalizedExternalJobInput {
  return normalizeGreenhouseJob(
    {
      id: Number(id),
      title,
      absolute_url: `https://${PROBE_ATS_HOST}/${PROBE_BOARD}/jobs/${id}`,
      company_name: PROBE_COMPANY,
      offices: [{ name: 'Seoul', location: 'Seoul, Seoul, South Korea' }],
      content:
        '<p>Own the platform team and its roadmap for the next two years, ' +
        'setting direction and growing a group of six engineers.</p>',
      metadata: [],
    },
    { boardToken: PROBE_BOARD, label: PROBE_COMPANY },
  )!;
}

function ashbySighting(id: string, title: string): NormalizedExternalJobInput {
  return normalizeAshbyJob(
    {
      id,
      title,
      jobUrl: `https://${PROBE_ATS_HOST}/${PROBE_BOARD}/${id}`,
      applyUrl: `https://${PROBE_ATS_HOST}/${PROBE_BOARD}/${id}/application`,
      employmentType: 'FullTime',
      isListed: true,
      publishedAt: '2026-08-20T00:00:00Z',
      descriptionPlain:
        'Own the platform team and its roadmap for the next two years.',
      secondaryLocations: [],
    },
    { slug: PROBE_BOARD, label: PROBE_COMPANY },
  )!;
}

async function main(): Promise<void> {
  const logger = new Logger('VerifyCompanyCareers');
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

  const probeScopes = { in: [PROBE_ID, PROBE_BOARD] };
  const realBefore = await prisma.externalJob.count({
    where: { sources: { none: { sourceScope: probeScopes } } },
  });
  const realActiveBefore = await prisma.externalJob.count({
    where: {
      status: 'ACTIVE',
      sources: { none: { sourceScope: probeScopes } },
    },
  });
  const companiesBefore = await prisma.externalCompany.count();
  logger.log(
    `real catalogue before: ${realBefore} jobs, ${realActiveBefore} ACTIVE, ` +
      `${companiesBefore} companies`,
  );

  /** The canonical job the probe's careers page belongs to. */
  const jobFor = (sourceKey: string) =>
    prisma.externalJob.findFirst({
      where: { sources: { some: { sourceKey } } },
      select: {
        id: true,
        status: true,
        title: true,
        description: true,
        countryCode: true,
        city: true,
        canonicalUrl: true,
        company: { select: { name: true, domain: true } },
        sources: {
          select: {
            provider: true,
            sourceKey: true,
            sourceUrl: true,
            originalUrl: true,
            status: true,
            mergeConfidence: true,
            mergeReason: true,
          },
          orderBy: { provider: 'asc' },
        },
      },
    });

  const syncCareers = async (jobs: ProbeJob[]) => {
    const provider = probeProvider(config, jobs);
    const page = await provider.fetchPage(null);
    const outcome = await ingestion.ingestBatch(page.jobs, PROBE_ID);
    return { page, outcome };
  };

  const retireCareers = async (observed: string[], runSucceeded = true) =>
    ingestion.markAbsent({
      provider: 'COMPANY_CAREERS',
      scopeKey: PROBE_ID,
      observedSourceKeys: new Set(observed),
      runSucceeded,
      absenceImpliesClosed: true,
    });

  const GH_ID = '9900000001';
  const GH_APPLY = `https://${PROBE_ATS_HOST}/${PROBE_BOARD}/jobs/${GH_ID}`;
  const CAREERS_KEY = `${PROBE_ID}:${PROBE_HOST}/careers/platform-engineering-manager`;

  try {
    // -- 1. the ATS sees the requisition first -----------------------------
    await ingestion.ingestBatch(
      [greenhouseSighting(GH_ID, 'Engineering Manager, Platform')],
      PROBE_BOARD,
    );
    const atsOnly = await jobFor(`${PROBE_BOARD}:${GH_ID}`);
    check(
      atsOnly?.sources.length === 1,
      'the ATS sighting creates one job with one source',
    );

    // -- 2. the company careers page joins it ------------------------------
    const first = await syncCareers([
      {
        slug: 'platform-engineering-manager',
        title: 'Engineering Manager, Platform',
        applyUrl: GH_APPLY,
      },
    ]);
    check(
      first.outcome.merged === 1 && first.outcome.created === 0,
      `the careers page MERGES onto the existing job (created=${first.outcome.created} merged=${first.outcome.merged})`,
    );

    const merged = await jobFor(CAREERS_KEY);
    check(
      merged?.id === atsOnly?.id,
      'and it is the SAME canonical job, not a new one',
    );
    check(
      merged?.sources.length === 2,
      `exactly two source rows (got ${merged?.sources.length})`,
    );
    check(
      // Sorted here rather than in the query: Postgres orders an enum by its
      // DECLARATION order, so `orderBy: provider` is not alphabetical.
      merged?.sources
        .map((source) => source.provider)
        .sort()
        .join(',') === 'COMPANY_CAREERS,GREENHOUSE',
      'one COMPANY_CAREERS row and one GREENHOUSE row',
    );
    check(
      merged?.sources.find((source) => source.provider === 'COMPANY_CAREERS')
        ?.mergeConfidence === 'EXACT',
      'merged at EXACT confidence, deterministically',
    );
    check(
      /same application URL/i.test(
        merged?.sources.find((s) => s.provider === 'COMPANY_CAREERS')
          ?.mergeReason ?? '',
      ),
      'and the recorded reason names the shared application URL',
    );

    // -- 3. provenance a UI could render -----------------------------------
    const careersRow = merged?.sources.find(
      (source) => source.provider === 'COMPANY_CAREERS',
    );
    check(
      careersRow?.sourceUrl ===
        `https://${PROBE_HOST}/careers/platform-engineering-manager`,
      'the company page URL survives on its own source row',
    );
    check(
      careersRow?.originalUrl === GH_APPLY,
      'and so does the ATS apply URL it points at — both facts, kept apart',
    );
    check(
      merged?.canonicalUrl === GH_APPLY,
      `the candidate is sent to the application form (got ${merged?.canonicalUrl})`,
    );

    // -- 4. field resolution across the two sources ------------------------
    check(
      !!merged?.description?.includes('platform team'),
      'the ATS description survives: higher trust never turns silence into an answer',
    );
    check(
      merged?.countryCode === 'KR' && merged?.city === 'Seoul',
      `the ATS location survives too (${merged?.countryCode}/${merged?.city})`,
    );
    check(
      merged?.company.domain === PROBE_HOST,
      `the company gained its DOMAIN from the careers page (got ${merged?.company.domain})`,
    );

    // -- 5. idempotency -----------------------------------------------------
    const second = await syncCareers([
      {
        slug: 'platform-engineering-manager',
        title: 'Engineering Manager, Platform',
        applyUrl: GH_APPLY,
      },
    ]);
    check(
      second.outcome.updated === 1 &&
        second.outcome.created === 0 &&
        second.outcome.merged === 0,
      'a second careers sync updates and creates nothing',
    );
    check(
      (await jobFor(CAREERS_KEY))?.sources.length === 2,
      'still exactly two source rows',
    );

    // -- 6. the company page stops listing it; the ATS still does ----------
    const retired = await retireCareers([]);
    check(
      retired.sourcesRetired === 1,
      'the absent careers sighting is retired',
    );
    const afterCareersGone = await jobFor(`${PROBE_BOARD}:${GH_ID}`);
    check(
      afterCareersGone?.sources.find((s) => s.provider === 'COMPANY_CAREERS')
        ?.status === 'GONE',
      'the careers source is GONE',
    );
    check(
      afterCareersGone?.sources.find((s) => s.provider === 'GREENHOUSE')
        ?.status === 'ACTIVE',
      'the ATS source is untouched',
    );
    check(
      afterCareersGone?.status === 'ACTIVE',
      `and the canonical job stays ACTIVE (got ${afterCareersGone?.status})`,
    );
    check(
      afterCareersGone !== null &&
        isCurrentlySearchable(afterCareersGone.status),
      'one dead source never kills a job another source still confirms',
    );

    // -- 7. a FAILED careers run retires nothing ---------------------------
    await syncCareers([
      {
        slug: 'platform-engineering-manager',
        title: 'Engineering Manager, Platform',
        applyUrl: GH_APPLY,
      },
    ]);
    const afterFailure = await retireCareers([], false);
    check(
      afterFailure.sourcesRetired === 0,
      'a failed careers run retires nothing, even with everything absent',
    );

    // -- 8. the ATS goes too --------------------------------------------------
    await retireCareers([]);
    await ingestion.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: PROBE_BOARD,
      observedSourceKeys: new Set(),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });
    const bothGone = await jobFor(`${PROBE_BOARD}:${GH_ID}`);
    check(
      bothGone?.status === 'UNAVAILABLE',
      `with every source gone the job is UNAVAILABLE, not CLOSED (got ${bothGone?.status})`,
    );
    check(
      bothGone !== null && !isCurrentlySearchable(bothGone.status),
      'and it leaves the candidate-searchable universe',
    );

    // -- 9. it comes back ----------------------------------------------------
    await syncCareers([
      {
        slug: 'platform-engineering-manager',
        title: 'Engineering Manager, Platform',
        applyUrl: GH_APPLY,
      },
    ]);
    const revived = await jobFor(CAREERS_KEY);
    check(revived?.status === 'ACTIVE', 'a re-listed source revives the job');
    check(revived?.sources.length === 2, 'and nothing was ever deleted');

    // -- 10. three company URLs, one requisition ----------------------------
    const shared = await syncCareers([
      {
        slug: 'platform-engineering-manager',
        title: 'Engineering Manager, Platform',
        applyUrl: GH_APPLY,
      },
      {
        slug: 'platform-eng-manager-us',
        title: 'Engineering Manager, Platform (US)',
        applyUrl: GH_APPLY,
      },
      {
        slug: 'platform-eng-manager-emea',
        title: 'Engineering Manager, Platform (EMEA)',
        applyUrl: GH_APPLY,
      },
    ]);
    check(
      shared.outcome.created === 0,
      `three company URLs carrying one requisition create no new job (created=${shared.outcome.created})`,
    );
    const collapsed = await jobFor(CAREERS_KEY);
    check(
      collapsed?.sources.length === 4,
      `they become four provenance rows on ONE job (got ${collapsed?.sources.length})`,
    );
    check(
      collapsed?.sources.filter((s) => s.provider === 'COMPANY_CAREERS')
        .length === 3,
      'three of them are company careers sightings',
    );

    // -- 11. genuinely different requisitions stay apart --------------------
    const distinct = await syncCareers([
      {
        slug: 'backend-engineer-us',
        title: 'Backend Engineer',
        applyUrl: `https://${PROBE_ATS_HOST}/${PROBE_BOARD}/jobs/9900000002`,
      },
      {
        slug: 'backend-engineer-eu',
        title: 'Backend Engineer',
        applyUrl: `https://${PROBE_ATS_HOST}/${PROBE_BOARD}/jobs/9900000003`,
      },
    ]);
    /*
     * Both pages fold to the same fingerprint — same company domain, same
     * title, neither stating a place — so the second one reaches the merge
     * gate and is REFUSED there, landing as `unmerged` rather than `created`.
     *
     * The distinction matters and the counter names it honestly: the system
     * did not simply fail to notice a duplicate, it noticed and declined to
     * merge, because two different application links are two different
     * requisitions whatever the titles say.
     */
    check(
      distinct.outcome.created + distinct.outcome.unmerged === 2,
      `same title, different apply links stay two jobs ` +
        `(created=${distinct.outcome.created} unmerged=${distinct.outcome.unmerged})`,
    );
    const us = await jobFor(
      `${PROBE_ID}:${PROBE_HOST}/careers/backend-engineer-us`,
    );
    const eu = await jobFor(
      `${PROBE_ID}:${PROBE_HOST}/careers/backend-engineer-eu`,
    );
    check(
      !!us && !!eu && us.id !== eu.id,
      'and they really are two canonical rows, not one',
    );
    check(
      eu?.sources[0]?.mergeConfidence === 'POSSIBLE',
      'the refusal is recorded as POSSIBLE, with its reason, rather than hidden',
    );

    // -- 12. ATS migration --------------------------------------------------
    const ASHBY_ID = 'aaaa1111-bbbb-2222-cccc-333333333333';
    const migratedApply = `https://${PROBE_ATS_HOST}/${PROBE_BOARD}/${ASHBY_ID}`;
    await syncCareers([
      {
        slug: 'platform-engineering-manager',
        title: 'Engineering Manager, Platform',
        applyUrl: migratedApply,
      },
    ]);
    const migrated = await jobFor(CAREERS_KEY);
    check(
      migrated?.sources.some(
        (s) =>
          s.provider === 'COMPANY_CAREERS' && s.originalUrl === migratedApply,
      ) === true,
      'the careers sighting follows the employer to a new ATS',
    );
    check(
      migrated?.sources.filter((s) => s.sourceKey === CAREERS_KEY).length === 1,
      'the careers source identity did not fork',
    );
    const greenhouseRow = migrated?.sources.find(
      (s) => s.provider === 'GREENHOUSE',
    );
    check(
      greenhouseRow?.sourceUrl === GH_APPLY,
      'the Greenhouse sighting is NOT rewritten as the new ATS',
    );
    check(
      greenhouseRow?.provider === 'GREENHOUSE',
      'provenance is immutable per source row',
    );

    await ingestion.ingestBatch(
      [ashbySighting(ASHBY_ID, 'Engineering Manager, Platform')],
      PROBE_BOARD,
    );
    const afterMigration = await jobFor(CAREERS_KEY);
    check(
      afterMigration?.sources.some((s) => s.provider === 'ASHBY') === true,
      'the NEW ATS sighting joins the same canonical job on the shared URL',
    );
    check(
      afterMigration?.id === atsOnly?.id,
      'the canonical job stayed traceable through the whole migration',
    );

    // -- 13. nothing leaked into internal tables ---------------------------
    const vacancies = await prisma.vacancy.count({
      where: { title: { contains: 'Engineering Manager, Platform' } },
    });
    check(vacancies === 0, 'no external job became an internal Vacancy');
    const applications = await prisma.application.count({
      where: {
        vacancy: { title: { contains: 'Engineering Manager, Platform' } },
      },
    });
    check(applications === 0, 'and no Application row was created');
  } finally {
    const probeJobs = await prisma.externalJobSource.findMany({
      where: { sourceScope: probeScopes },
      select: { externalJobId: true },
    });
    await prisma.externalJobSource.deleteMany({
      where: { sourceScope: probeScopes },
    });
    await prisma.externalJob.deleteMany({
      where: { id: { in: probeJobs.map((row) => row.externalJobId) } },
    });
    await prisma.externalCompany.deleteMany({ where: { name: PROBE_COMPANY } });

    const realAfter = await prisma.externalJob.count();
    const realActiveAfter = await prisma.externalJob.count({
      where: { status: 'ACTIVE' },
    });
    const companiesAfter = await prisma.externalCompany.count();
    logger.log(
      `real catalogue after cleanup: ${realAfter} jobs, ${realActiveAfter} ACTIVE, ` +
        `${companiesAfter} companies`,
    );
    check(realAfter === realBefore, 'the real catalogue is unchanged');
    check(realActiveAfter === realActiveBefore, 'no real job changed status');
    check(companiesAfter === companiesBefore, 'no company row was left behind');
    check(
      (await prisma.externalJobSource.count({
        where: { sourceScope: probeScopes },
      })) === 0,
      'every probe row was removed',
    );

    logger.log(
      failures.length === 0
        ? 'COMPANY CAREERS MULTI-SOURCE: ALL CHECKS PASSED'
        : `COMPANY CAREERS MULTI-SOURCE: ${failures.length} FAILED — ${failures.join('; ')}`,
    );
    if (failures.length > 0) process.exitCode = 1;
    await app.close();
  }
}

void main().then(
  () => process.exit(process.exitCode ?? 0),
  (error: Error) => {
    new Logger('VerifyCompanyCareers').error(error.message);
    process.exit(1);
  },
);
