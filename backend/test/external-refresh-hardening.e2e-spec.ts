import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { Queue, Worker } from 'bullmq';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { ExternalSyncScheduler } from '../src/external-jobs/external-sync.scheduler';
import { ExternalRevalidateService } from '../src/external-jobs/external-revalidate.service';
import { ExternalIngestionService } from '../src/external-jobs/external-ingestion.service';
import {
  DEFAULT_STALENESS_MS,
  EXTERNAL_JOBS_QUEUE,
  EXTERNAL_PROVIDER_SYNC_JOB,
} from '../src/external-jobs/external-jobs.constants';
import type { ExternalProviderRegistry } from '../src/external-jobs/provider-registry';

/**
 * Production hardening of the external refresh path, proven live:
 *
 *  1. against REAL Redis and REAL BullMQ — on a throwaway queue, so not one
 *     provider HTTP request happens — that scheduler registration survives
 *     restarts without immediate re-execution and without cadence drift;
 *  2. against the REAL database that the ageing pass applies exactly the
 *     conservative lifecycle transitions and nothing else.
 */
describe('External refresh production hardening (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let revalidate: ExternalRevalidateService;

  const run = Date.now().toString(36);
  const MARKER = `zzrh${run}`;
  const PASSWORD = 'CorrectHorseBattery1!';
  const maxEmail = `rh-max-${run}@e2e.test`;
  let maxToken: string;
  let companyId: string;

  const DAY = 24 * 60 * 60_000;
  const now = () => new Date();
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

  async function makeJob(
    key: string,
    over: Record<string, unknown> = {},
    withSource = false,
  ) {
    const job = await prisma.externalJob.create({
      data: {
        dedupeFingerprint: `${MARKER}-${key}`,
        externalCompanyId: companyId,
        title: `${MARKER} Backend Engineer ${key}`,
        normalizedTitle: `${MARKER} backend engineer ${key}`,
        description: 'Fixture posting.',
        countryCode: 'KR',
        status: 'ACTIVE',
        canonicalUrl: `https://boards.zzfixture.invalid/${MARKER}/${key}`,
        ...over,
      },
      select: { id: true },
    });
    if (withSource) {
      await prisma.externalJobSource.create({
        data: {
          externalJobId: job.id,
          provider: 'GREENHOUSE',
          accessMethod: 'OFFICIAL_API',
          sourceKey: `${MARKER}:${key}`,
          sourceUrl: `https://boards.zzfixture.invalid/${MARKER}/${key}`,
          originalUrl: `https://boards.zzfixture.invalid/${MARKER}/${key}`,
          status: 'ACTIVE',
        },
      });
    }
    return job.id;
  }

  const status = async (id: string) =>
    (
      await prisma.externalJob.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      })
    ).status;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    revalidate = app.get(ExternalRevalidateService);
    http = app.getHttpServer();

    maxToken = (
      await request(http)
        .post('/auth/register/candidate')
        .send({ fullName: 'RH Max', email: maxEmail, password: PASSWORD })
    ).body.accessToken as string;
    await prisma.candidateAccount.updateMany({
      where: { user: { email: maxEmail } },
      data: { plan: 'MAX' },
    });

    companyId = (
      await prisma.externalCompany.create({
        data: {
          name: `ZZ Refresh Fixture ${run}`,
          normalizedName: `zz refresh fixture ${run}`,
          domain: '',
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    const jobs = await prisma.externalJob.findMany({
      where: { externalCompanyId: companyId },
      select: { id: true },
    });
    const ids = jobs.map((job) => job.id);
    await prisma.externalJobSource.deleteMany({
      where: { externalJobId: { in: ids } },
    });
    await prisma.externalJob.deleteMany({ where: { id: { in: ids } } });
    await prisma.externalCompany.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { email: maxEmail } });
    await app.close();
  });

  describe('scheduler restart safety — real BullMQ, real Redis, throwaway queue', () => {
    let queue: Queue;
    const SIX_HOURS = 6 * 60 * 60_000;

    const registry = {
      list: () =>
        ['GREENHOUSE', 'LEVER', 'ASHBY'].map((name) => ({
          descriptor: { provider: name },
        })),
    } as unknown as ExternalProviderRegistry;

    const config = (enabled: boolean) =>
      ({
        get: (key: string, fallback: unknown) =>
          ({
            'externalJobs.scheduleEnabled': enabled,
            'externalJobs.syncIntervalMs': SIX_HOURS,
            'externalJobs.revalidateIntervalMs': 60 * 60_000,
          })[key] ?? fallback,
      }) as unknown as ConfigService;

    const bootScheduler = (enabled = true) =>
      new ExternalSyncScheduler(
        queue,
        registry,
        config(enabled),
      ).onModuleInit();

    beforeAll(() => {
      const options = redis.client.options as { host?: string; port?: number };
      queue = new Queue(`zz-e2e-refresh-${run}`, {
        connection: { host: options.host, port: options.port },
      });
    });

    afterAll(async () => {
      await queue.obliterate({ force: true });
      await queue.close();
    });

    it('boot 1 registers one scheduler per provider plus revalidation, at 6 hours', async () => {
      await bootScheduler();
      const schedulers = await queue.getJobSchedulers();

      expect(schedulers.map((s) => s.key).sort()).toEqual([
        'external-revalidate',
        'external-sync:ashby',
        'external-sync:greenhouse',
        'external-sync:lever',
      ]);
      for (const scheduler of schedulers) {
        if (scheduler.key === 'external-revalidate') continue;
        expect(scheduler.every).toBe(SIX_HOURS);
        expect(scheduler.name).toBe(EXTERNAL_PROVIDER_SYNC_JOB);
      }
    });

    it('after the first iterations run, the next occurrence sits in the FUTURE', async () => {
      /*
       * Consume the intended immediate first iterations with a worker whose
       * processor is a no-op — the job NAMES match production but the queue
       * is a fixture, so zero provider HTTP happens. This reproduces the
       * production steady state: a sweep just ran, the next one is pending.
       */
      const worker = new Worker(queue.name, () => Promise.resolve(), {
        connection: (queue.opts as { connection: object }).connection as never,
      });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await worker.close();

      for (const scheduler of await queue.getJobSchedulers()) {
        // Every schedule's next occurrence is in the future — the provider
        // ones a good part of six hours out, the hourly revalidation within
        // its own shorter interval.
        expect(scheduler.next).toBeGreaterThan(Date.now());
        if (scheduler.key !== 'external-revalidate') {
          expect(scheduler.next).toBeGreaterThan(Date.now() + SIX_HOURS / 2);
        }
      }
    });

    it('a restart preserves the pending run — no immediate sweep, no drift', async () => {
      const before = new Map(
        (await queue.getJobSchedulers()).map((s) => [s.key, s.next]),
      );
      const countsBefore = await queue.getJobCounts();

      // Three "deploys" in a row, exactly as a crash loop would produce.
      await bootScheduler();
      await bootScheduler();
      await bootScheduler();

      const after = await queue.getJobSchedulers();
      expect(after).toHaveLength(4);
      for (const scheduler of after) {
        // The next occurrence is EXACTLY the one that was already pending:
        // not now (the historical bug), not pushed a further 6h out (what a
        // blind upsert would do in bullmq 6.1.2).
        expect(scheduler.next).toBe(before.get(scheduler.key));
        expect(scheduler.next).toBeGreaterThan(Date.now());
      }
      // And no new job of any kind was produced by rebooting.
      expect(await queue.getJobCounts()).toEqual(countsBefore);
    });

    it('two replicas registering concurrently stay at one scheduler per provider', async () => {
      await Promise.all([bootScheduler(), bootScheduler()]);
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toHaveLength(4);
      const keys = schedulers.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('disable removes everything; re-enable restores one per provider', async () => {
      await bootScheduler(false);
      expect(await queue.getJobSchedulers()).toHaveLength(0);

      await bootScheduler(true);
      const restored = await queue.getJobSchedulers();
      expect(restored).toHaveLength(4);
    });

    it('the REAL queue keeps zero schedulers while sync is disabled locally', async () => {
      const options = redis.client.options as { host?: string; port?: number };
      const real = new Queue(EXTERNAL_JOBS_QUEUE, {
        connection: { host: options.host, port: options.port },
      });
      try {
        // EXTERNAL_SYNC_ENABLED=false is this environment's documented
        // state: booting the app must leave no standing schedule behind.
        expect(await real.getJobSchedulers()).toHaveLength(0);
      } finally {
        await real.close();
      }
    });
  });

  describe('ageing — conservative lifecycle maintenance on the real database', () => {
    it('recently verified ACTIVE stays ACTIVE', async () => {
      const id = await makeJob('active-fresh', {
        lastSeenAt: daysAgo(1),
        lastVerifiedAt: daysAgo(1),
      });
      await revalidate.revalidate({ jobIds: [id] });
      expect(await status(id)).toBe('ACTIVE');
    });

    it('ACTIVE unobserved beyond the 14-day window becomes STALE — and only STALE', async () => {
      const id = await makeJob('active-old', {
        lastSeenAt: daysAgo(15),
        lastVerifiedAt: daysAgo(15),
      });
      await revalidate.revalidate({ jobIds: [id] });
      expect(await status(id)).toBe('STALE');
      // This is exactly the provider-removed-from-config path: nothing
      // observes the job any more, so it ages to visible-but-stale, never
      // to CLOSED. (Age is not closure evidence.)
    });

    it('the boundary honors the EXISTING staleness constant', async () => {
      const justInside = await makeJob('active-13d', {
        lastSeenAt: new Date(Date.now() - (DEFAULT_STALENESS_MS - 60 * 60_000)),
      });
      await revalidate.revalidate({ jobIds: [justInside] });
      expect(await status(justInside)).toBe('ACTIVE');
    });

    it('STALE remains STALE while still unverifiable — never CLOSED by age', async () => {
      const id = await makeJob('stale-old', {
        status: 'STALE',
        lastSeenAt: daysAgo(40),
      });
      await revalidate.revalidate({ jobIds: [id] });
      await revalidate.revalidate({ jobIds: [id] });
      expect(await status(id)).toBe('STALE');
    });

    it('a passed employer deadline is HARD-DELETED — live-only, no EXPIRED archive', async () => {
      const fromActive = await makeJob('expire-a', {
        lastSeenAt: daysAgo(1),
        expiresAt: daysAgo(1),
      });
      const fromStale = await makeJob('expire-s', {
        status: 'STALE',
        lastSeenAt: daysAgo(20),
        expiresAt: daysAgo(2),
      });
      const future = await makeJob('expire-future', {
        lastSeenAt: daysAgo(1),
        expiresAt: new Date(Date.now() + 30 * DAY),
      });
      const outcome = await revalidate.revalidate({
        jobIds: [fromActive, fromStale, future],
      });

      // The employer's own stated deadline is authoritative closure: the rows
      // are gone entirely (FK cascade takes their sources with them), and the
      // ids are reported so the Qdrant reconciliation can follow PostgreSQL.
      expect(
        await prisma.externalJob.findUnique({ where: { id: fromActive } }),
      ).toBeNull();
      expect(
        await prisma.externalJob.findUnique({ where: { id: fromStale } }),
      ).toBeNull();
      expect(await status(future)).toBe('ACTIVE');
      expect(outcome.expired).toBe(2);
      expect(outcome.removedJobIds).toEqual(
        expect.arrayContaining([fromActive, fromStale]),
      );
      expect(
        await prisma.externalJobSource.count({
          where: { externalJobId: { in: [fromActive, fromStale] } },
        }),
      ).toBe(0);
    });

    it('legacy CLOSED/UNAVAILABLE rows are PURGED — zero retained history', async () => {
      const closed = await makeJob('closed', {
        status: 'CLOSED',
        lastSeenAt: daysAgo(40),
        closedAt: daysAgo(30),
      });
      const unavailable = await makeJob('unavailable', {
        status: 'UNAVAILABLE',
        lastSeenAt: daysAgo(40),
      });
      const outcome = await revalidate.revalidate({
        jobIds: [closed, unavailable],
      });
      // Their statuses were assigned by authoritative signals when the old
      // lifecycle marked them; the live-only lifecycle removes the archive.
      expect(
        await prisma.externalJob.findUnique({ where: { id: closed } }),
      ).toBeNull();
      expect(
        await prisma.externalJob.findUnique({ where: { id: unavailable } }),
      ).toBeNull();
      expect(outcome.purged).toBe(2);
    });

    it('the candidate universe: STALE visible, EXPIRED/CLOSED/UNAVAILABLE hidden', async () => {
      const stale = await makeJob('universe-stale', {
        status: 'STALE',
        lastSeenAt: daysAgo(20),
      });
      const expired = await makeJob('universe-expired', {
        status: 'EXPIRED',
        closedAt: daysAgo(1),
      });
      const closed = await makeJob('universe-closed', { status: 'CLOSED' });
      const unavailable = await makeJob('universe-unavailable', {
        status: 'UNAVAILABLE',
      });

      const detail = (id: string) =>
        request(http)
          .get(`/candidate-account/me/external-jobs/${id}`)
          .set('Authorization', `Bearer ${maxToken}`);
      await detail(stale).expect(200);
      await detail(expired).expect(404);
      await detail(closed).expect(404);
      await detail(unavailable).expect(404);
    });

    it('CURRENT (ACTIVE/STALE) rows all survive a full pass — only departures are deleted', async () => {
      const current = {
        externalCompanyId: companyId,
        status: { in: ['ACTIVE', 'STALE'] as ('ACTIVE' | 'STALE')[] },
      };
      const currentWithoutDeadline = {
        ...current,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      };
      const before = await prisma.externalJob.count({
        where: currentWithoutDeadline,
      });
      expect(before).toBeGreaterThan(0);
      await revalidate.revalidate();
      // Age alone deletes nothing: STALE flips are the only writes the pass
      // makes to current rows, and every fixture without a passed deadline is
      // still here.
      expect(
        await prisma.externalJob.count({ where: currentWithoutDeadline }),
      ).toBe(before);
    });

    it('a re-observed STALE job returns to ACTIVE through normal ingestion', async () => {
      const id = await makeJob(
        'relisted',
        { lastSeenAt: daysAgo(20), lastVerifiedAt: daysAgo(20) },
        true,
      );
      await revalidate.revalidate({ jobIds: [id] });
      expect(await status(id)).toBe('STALE');

      // The next provider sweep re-observes the posting: the source is seen
      // now, and the ingestion recompute — not the ageing pass — restores
      // ACTIVE. Ageing itself has no upgrade path by design.
      await prisma.externalJobSource.updateMany({
        where: { externalJobId: id },
        data: { lastSeenAt: now(), status: 'ACTIVE' },
      });
      await app.get(ExternalIngestionService).reconcileJob(id);
      expect(await status(id)).toBe('ACTIVE');
    });

    it('two concurrent ageing runs partition the work and corrupt nothing', async () => {
      const ids = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          makeJob(`concurrent-${i}`, { lastSeenAt: daysAgo(15) }),
        ),
      );
      const [first, second] = await Promise.all([
        revalidate.revalidate({ jobIds: ids }),
        revalidate.revalidate({ jobIds: ids }),
      ]);

      for (const id of ids) expect(await status(id)).toBe('STALE');
      // Every row transitioned exactly once across the two runs.
      expect(first.staled + second.staled).toBe(ids.length);
    });

    it('scale: a 1200-row backlog is worked in bounded batches', async () => {
      await prisma.externalJob.createMany({
        data: Array.from({ length: 1200 }, (_, i) => ({
          dedupeFingerprint: `${MARKER}-bulk-${i}`,
          externalCompanyId: companyId,
          title: `${MARKER} Bulk ${i}`,
          normalizedTitle: `${MARKER} bulk ${i}`,
          countryCode: 'KR',
          status: 'ACTIVE' as const,
          lastSeenAt: daysAgo(15),
          canonicalUrl: `https://boards.zzfixture.invalid/${MARKER}/bulk-${i}`,
        })),
      });

      const outcome = await revalidate.revalidate();
      expect(outcome.staled).toBeGreaterThanOrEqual(1200);
      // 1200 rows at batch size 500 ⇒ at least three stale batches.
      expect(outcome.batches).toBeGreaterThanOrEqual(4);
      expect(outcome.truncated).toBe(false);
      expect(
        await prisma.externalJob.count({
          where: {
            externalCompanyId: companyId,
            normalizedTitle: { startsWith: `${MARKER} bulk` },
            status: 'STALE',
          },
        }),
      ).toBe(1200);
    });

    it('a full pass produces no CLOSED row it did not find already CLOSED', async () => {
      const closedBefore = await prisma.externalJob.count({
        where: { externalCompanyId: companyId, status: 'CLOSED' },
      });
      await revalidate.revalidate();
      expect(
        await prisma.externalJob.count({
          where: { externalCompanyId: companyId, status: 'CLOSED' },
        }),
      ).toBe(closedBefore);
    });
  });
});
