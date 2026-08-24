import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Candidate external search, end to end against the REAL database.
 *
 * What only a real database can prove, and what this suite is therefore for:
 *
 *  - the current-universe rule in SQL — ACTIVE and STALE are searchable,
 *    CLOSED, EXPIRED and UNAVAILABLE are not, and no source status can
 *    resurrect a canonical job that left;
 *  - `additionalLocations` actually participating in the location filter,
 *    through the JSONB containment the index supports. The column has been
 *    stored since Task 4B.3 and read by nothing until now;
 *  - remote NOT meaning worldwide, against real rows;
 *  - the generated full-text column matching Korean and English;
 *  - ownership over real HTTP: a recruiter refused, one candidate unable to
 *    reach another's run, and no id anywhere to substitute.
 *
 * Every fixture is created under a unique run prefix and removed afterwards.
 * The live provider catalogue is never touched — the assertions are written
 * against the fixtures' own ids, so a concurrent provider sweep cannot make
 * them flap.
 */
describe('Candidate external job search (e2e, real database)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const PASSWORD = 'CorrectHorseBattery1!';
  const seekerEmail = `xsearch-seeker-${run}@e2e.test`;
  const otherEmail = `xsearch-other-${run}@e2e.test`;
  const recruiterEmail = `xsearch-recruiter-${run}@e2e.test`;
  const orgSlug = `e2e-xsearch-${run}`;
  const COMPANY = `ZZ Search Fixture ${run}`;

  let seekerToken: string;
  let otherToken: string;
  let recruiterToken: string;
  let seekerAccountId: string;
  let companyId: string;

  /** Fixture titles are nonsense on purpose: no live posting can collide. */
  const MARKER = `zzqx${run}`;
  const ids: Record<string, string> = {};

  const SEARCH = '/candidate-account/me/external-jobs/search';

  const search = (token: string, body: Record<string, unknown>) =>
    request(http)
      .post(SEARCH)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  /** Only this suite's fixtures, so live catalogue drift cannot affect it. */
  const mine = (body: { results: { externalJobId: string }[] }) =>
    body.results
      .map((result) => result.externalJobId)
      .filter((id) => Object.values(ids).includes(id));

  async function makeJob(
    key: string,
    over: Record<string, unknown> = {},
  ): Promise<void> {
    const job = await prisma.externalJob.create({
      data: {
        dedupeFingerprint: `${MARKER}-${key}`,
        externalCompanyId: companyId,
        title: `${MARKER} Backend Engineer`,
        normalizedTitle: `${MARKER} backend engineer`,
        description: 'Build and operate services for the platform team.',
        countryCode: 'US',
        city: 'New York City',
        status: 'ACTIVE',
        canonicalUrl: `https://boards.zzfixture.invalid/${MARKER}/${key}`,
        ...over,
      },
      select: { id: true },
    });
    ids[key] = job.id;
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer();

    const seeker = await request(http).post('/auth/register/candidate').send({
      fullName: 'Search Seeker',
      email: seekerEmail,
      password: PASSWORD,
    });
    seekerToken = seeker.body.accessToken;

    const other = await request(http).post('/auth/register/candidate').send({
      fullName: 'Other Seeker',
      email: otherEmail,
      password: PASSWORD,
    });
    otherToken = other.body.accessToken;

    const recruiter = await request(http)
      .post('/auth/register/organization')
      .send({
        organizationName: 'E2E Search Org',
        organizationSlug: orgSlug,
        fullName: 'Search Recruiter',
        email: recruiterEmail,
        password: PASSWORD,
      });
    recruiterToken = recruiter.body.accessToken;

    seekerAccountId = (
      await prisma.candidateAccount.findFirstOrThrow({
        where: { user: { email: seekerEmail } },
        select: { id: true },
      })
    ).id;

    // External search is the MAX product (Task 4C.5.1). These fixtures test
    // the SEARCH, not the plan gate — plan-entitlements.e2e-spec.ts owns
    // that — so both candidates are elevated through the supported fixture
    // path (a direct plan write; no HTTP endpoint can do this).
    await prisma.candidateAccount.updateMany({
      where: { user: { email: { in: [seekerEmail, otherEmail] } } },
      data: { plan: 'MAX' },
    });

    companyId = (
      await prisma.externalCompany.create({
        data: {
          name: COMPANY,
          normalizedName: COMPANY.toLowerCase(),
          domain: '',
        },
        select: { id: true },
      })
    ).id;

    // -- The universe: one job per lifecycle state ------------------------
    await makeJob('active');
    await makeJob('stale', { status: 'STALE' });
    await makeJob('closed', { status: 'CLOSED' });
    await makeJob('expired', {
      status: 'EXPIRED',
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    });
    await makeJob('unavailable', { status: 'UNAVAILABLE' });

    // -- Location -----------------------------------------------------------
    // Primary US, ALSO open in Toronto. The whole point of the JSONB column.
    await makeJob('multiLocation', {
      additionalLocations: [
        { countryCode: 'CA', region: 'Ontario', city: 'Toronto' },
        { countryCode: 'DE', region: null, city: 'Berlin' },
      ],
    });
    // Remote, but only for people who may work in the US.
    await makeJob('remoteUsOnly', {
      countryCode: null,
      city: null,
      workMode: 'REMOTE',
      remoteCountriesAllowed: ['US'],
    });
    // Remote with no stated geography — unknown, not worldwide.
    await makeJob('remoteUnknown', {
      countryCode: null,
      city: null,
      workMode: 'REMOTE',
      remoteCountriesAllowed: [],
    });
    // No location at all.
    await makeJob('noLocation', { countryCode: null, city: null });

    // -- Language and profession -------------------------------------------
    await makeJob('korean', {
      title: `${MARKER} 백엔드 개발자`,
      normalizedTitle: `${MARKER} 백엔드 개발자`,
      description: '백엔드 서비스를 함께 만들어 갈 동료를 찾습니다.',
      countryCode: 'KR',
      city: '서울',
    });
    await makeJob('accountant', {
      title: `${MARKER} Senior Accountant`,
      normalizedTitle: `${MARKER} senior accountant`,
      description: 'Own month-end close and statutory reporting.',
    });
    await makeJob('nurse', {
      title: `${MARKER} Registered Nurse`,
      normalizedTitle: `${MARKER} registered nurse`,
      description: 'Provide direct patient care on a busy ward.',
    });

    // -- Soft dimensions ----------------------------------------------------
    await makeJob('remoteFullTime', {
      workMode: 'REMOTE',
      remoteCountriesAllowed: ['US'],
      employmentType: 'FULL_TIME',
    });
    await makeJob('onsiteContract', {
      workMode: 'ONSITE',
      employmentType: 'CONTRACT',
    });
    await makeJob('paid', {
      salaryMin: 200_000,
      salaryMax: 250_000,
      currency: 'USD',
      payPeriod: 'YEARLY',
    });
    await makeJob('lowPaid', {
      salaryMin: 30_000,
      salaryMax: 35_000,
      currency: 'USD',
      payPeriod: 'YEARLY',
    });
  });

  afterAll(async () => {
    const fixtures = await prisma.externalJob.findMany({
      where: { externalCompanyId: companyId },
      select: { id: true },
    });
    await prisma.externalJobSource.deleteMany({
      where: { externalJobId: { in: fixtures.map((job) => job.id) } },
    });
    await prisma.externalJob.deleteMany({
      where: { externalCompanyId: companyId },
    });
    await prisma.externalCompany.deleteMany({ where: { id: companyId } });
    await prisma.organization.deleteMany({ where: { slug: orgSlug } });
    await prisma.user.deleteMany({
      where: { email: { in: [seekerEmail, otherEmail, recruiterEmail] } },
    });
    await app.close();
  });

  afterEach(async () => {
    await prisma.candidateJobPreferences.deleteMany({
      where: { candidateAccountId: seekerAccountId },
    });
  });

  describe('ownership', () => {
    it('rejects an unauthenticated request', async () => {
      await request(http).post(SEARCH).send({ query: 'x' }).expect(401);
    });

    it('rejects an ORGANIZATION account', async () => {
      // A recruiter has no personalized job search; this surface is not theirs.
      await search(recruiterToken, { query: 'Backend' }).expect(403);
    });

    it('has no account id to substitute', async () => {
      const response = await search(seekerToken, {
        candidateAccountId: 'someone-else',
        query: 'Backend',
      });
      expect(response.status).toBe(400);
    });

    it('gives each candidate their own run', async () => {
      const mineRun = await search(seekerToken, { query: MARKER }).expect(200);
      const theirs = await search(otherToken, { query: MARKER }).expect(200);
      expect(theirs.body.runId).not.toBe(mineRun.body.runId);

      const rows = await prisma.candidateExternalSearchRun.findMany({
        where: { id: { in: [mineRun.body.runId, theirs.body.runId] } },
        select: { candidateAccountId: true },
      });
      expect(new Set(rows.map((row) => row.candidateAccountId)).size).toBe(2);
    });

    it('validates the query length rather than accepting anything', async () => {
      await search(seekerToken, { query: 'x'.repeat(500) }).expect(400);
      await search(seekerToken, { countries: ['NOTACODE'] }).expect(400);
      await search(seekerToken, { pageSize: 5_000 }).expect(400);
    });
  });

  describe('the current universe', () => {
    it('returns ACTIVE and STALE, and nothing else', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      const found = mine(response.body);

      expect(found).toContain(ids.active);
      expect(found).toContain(ids.stale);
      // Not merely ranked lower — absent.
      expect(found).not.toContain(ids.closed);
      expect(found).not.toContain(ids.expired);
      expect(found).not.toContain(ids.unavailable);
    });

    it('marks a STALE listing rather than hiding it', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      const stale = response.body.results.find(
        (result: { externalJobId: string }) =>
          result.externalJobId === ids.stale,
      );
      expect(stale.status).toBe('STALE');
      expect(
        stale.reasons.map((reason: { code: string }) => reason.code),
      ).toContain('STALE_LISTING');
    });

    it('cannot be resurrected by a live SOURCE row', async () => {
      /*
       * The canonical status decides. A source that still says ACTIVE on a job
       * the lifecycle closed must not put it back in front of a candidate.
       */
      const sources = await prisma.externalJobSource.findMany({
        where: { externalJobId: ids.closed },
        select: { status: true },
      });
      expect(sources.every((source) => source.status === 'ACTIVE')).toBe(true);

      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      expect(mine(response.body)).not.toContain(ids.closed);
    });
  });

  describe('explicit location is hard, and reads additionalLocations', () => {
    it('finds a job by its PRIMARY country', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        countries: ['US'],
        pageSize: 100,
      }).expect(200);
      expect(mine(response.body)).toContain(ids.active);
    });

    it('finds a job by an ADDITIONAL country', async () => {
      /*
       * The field has been stored since Task 4B.3 and queried by nothing. A
       * requisition open in New York AND Toronto answers a search for Canada,
       * and querying the primary column alone would silently exclude a
       * candidate the employer would have hired.
       */
      const response = await search(seekerToken, {
        query: MARKER,
        countries: ['CA'],
        pageSize: 100,
      }).expect(200);
      const found = mine(response.body);
      expect(found).toContain(ids.multiLocation);
      // A US-primary job with no Canadian office does not answer it.
      expect(found).not.toContain(ids.active);
    });

    it('finds a job by a SECOND additional country', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        countries: ['DE'],
        pageSize: 100,
      }).expect(200);
      expect(mine(response.body)).toContain(ids.multiLocation);
    });

    it('excludes a job listed in neither', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        countries: ['JP'],
        pageSize: 100,
      }).expect(200);
      expect(mine(response.body)).not.toContain(ids.multiLocation);
    });

    it('returns the multi-location data to the caller', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        countries: ['CA'],
        pageSize: 100,
      }).expect(200);
      const job = response.body.results.find(
        (r: { externalJobId: string }) => r.externalJobId === ids.multiLocation,
      );
      expect(job.additionalLocations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ countryCode: 'CA', city: 'Toronto' }),
        ]),
      );
    });
  });

  describe('remote is not worldwide', () => {
    it('matches a remote job only in a country the employer listed', async () => {
      const inUs = await search(seekerToken, {
        query: MARKER,
        countries: ['US'],
        pageSize: 100,
      }).expect(200);
      expect(mine(inUs.body)).toContain(ids.remoteUsOnly);

      const inCanada = await search(seekerToken, {
        query: MARKER,
        countries: ['CA'],
        pageSize: 100,
      }).expect(200);
      // REMOTE is not a passport. The employer said US.
      expect(mine(inCanada.body)).not.toContain(ids.remoteUsOnly);
    });

    it('never treats unstated remote geography as everywhere', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        countries: ['CA'],
        pageSize: 100,
      }).expect(200);
      expect(mine(response.body)).not.toContain(ids.remoteUnknown);
    });

    it('keeps unknown-location jobs fully reachable without a filter', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      const found = mine(response.body);
      expect(found).toContain(ids.remoteUnknown);
      expect(found).toContain(ids.noLocation);
    });

    it('excludes unknown location from an EXPLICIT country search', async () => {
      // The documented choice, matching internal Find Jobs: "we do not know
      // where this job is" does not satisfy "must be in the US".
      const response = await search(seekerToken, {
        query: MARKER,
        countries: ['US'],
        pageSize: 100,
      }).expect(200);
      expect(mine(response.body)).not.toContain(ids.noLocation);
    });
  });

  describe('saved preferences rank, they never hide', () => {
    const savePreference = (body: Record<string, unknown>) =>
      request(http)
        .put('/candidate-account/me/job-preferences')
        .set('Authorization', `Bearer ${seekerToken}`)
        .send(body)
        .expect(200);

    it('keeps the whole text universe when a country is only SAVED', async () => {
      const before = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);

      await savePreference({
        preferredLocations: [{ countryCode: 'KR', city: 'Seoul' }],
      });

      const after = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);

      // Same universe, different order. This is the bug the internal side
      // already had once: a saved city silently filtering a search.
      expect(after.body.total).toBe(before.body.total);
      expect(after.body.matched).toBe(before.body.matched);
      expect(after.body.applied.countries.source).toBe('PREFERENCE');
      expect(mine(after.body)).toEqual(
        expect.arrayContaining([ids.active, ids.korean]),
      );
    });

    it('ranks the aligned job higher without removing the others', async () => {
      await savePreference({
        preferredLocations: [{ countryCode: 'KR', city: '서울' }],
      });
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);

      const found = mine(response.body);
      expect(found).toContain(ids.korean);
      expect(found).toContain(ids.active);
      const korean = found.indexOf(ids.korean);
      const other = found.indexOf(ids.active);
      expect(korean).toBeLessThan(other);
    });

    it('keeps every work mode reachable when one is preferred', async () => {
      await savePreference({ preferredWorkModes: ['REMOTE'] });
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      const found = mine(response.body);
      expect(found).toContain(ids.remoteFullTime);
      expect(found).toContain(ids.onsiteContract);
      expect(found.indexOf(ids.remoteFullTime)).toBeLessThan(
        found.indexOf(ids.onsiteContract),
      );
    });

    it('keeps a below-floor salary reachable, ranked below one that meets it', async () => {
      await savePreference({
        desiredSalaryMin: 100_000,
        salaryCurrency: 'USD',
        payPeriod: 'YEARLY',
      });
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      const found = mine(response.body);
      expect(found).toContain(ids.lowPaid);
      expect(found.indexOf(ids.paid)).toBeLessThan(found.indexOf(ids.lowPaid));
    });

    it('stops applying a preference once it is deleted', async () => {
      await savePreference({ preferredWorkModes: ['REMOTE'] });
      const applied = await search(seekerToken, { query: MARKER }).expect(200);
      expect(applied.body.applied.workModes.source).toBe('PREFERENCE');

      await request(http)
        .delete('/candidate-account/me/job-preferences')
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(200);

      const after = await search(seekerToken, { query: MARKER }).expect(200);
      expect(after.body.applied.workModes.source).toBe('UNSPECIFIED');
      expect(after.body.runId).not.toBe(applied.body.runId);
    });
  });

  describe('text query', () => {
    it('narrows the universe to what was asked', async () => {
      const accountant = await search(seekerToken, {
        query: `${MARKER} Accountant`,
        pageSize: 100,
      }).expect(200);
      const found = mine(accountant.body);
      expect(found).toContain(ids.accountant);
      // A nurse posting does not answer a search for an accountant.
      expect(found).not.toContain(ids.nurse);
    });

    it('serves professions outside engineering', async () => {
      for (const [key, query] of [
        ['accountant', `${MARKER} Accountant`],
        ['nurse', `${MARKER} Registered Nurse`],
      ] as const) {
        const response = await search(seekerToken, {
          query,
          pageSize: 100,
        }).expect(200);
        expect(mine(response.body)).toContain(ids[key]);
      }
    });

    it('finds a Korean title with a Korean query, unromanized', async () => {
      const response = await search(seekerToken, {
        query: '백엔드 개발자',
        pageSize: 100,
      }).expect(200);
      expect(mine(response.body)).toContain(ids.korean);
      const job = response.body.results.find(
        (r: { externalJobId: string }) => r.externalJobId === ids.korean,
      );
      // Stored and returned as Korean. Nothing transliterated it.
      expect(job.title).toContain('백엔드 개발자');
    });

    it('returns a clean empty result rather than relaxing the request', async () => {
      const response = await search(seekerToken, {
        query: 'zzzznothingmatchesthisquery',
        pageSize: 100,
      }).expect(200);
      expect(response.body.results).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('makes every current job eligible when no query is given', async () => {
      const response = await search(seekerToken, { pageSize: 100 }).expect(200);
      expect(response.body.matched).toBeGreaterThanOrEqual(15);
    });
  });

  describe('pagination', () => {
    it('pages without duplicates and with a stable total', async () => {
      const first = await search(seekerToken, {
        query: MARKER,
        pageSize: 5,
      }).expect(200);
      const second = await search(seekerToken, {
        query: MARKER,
        pageSize: 5,
        page: 2,
      }).expect(200);

      expect(second.body.total).toBe(first.body.total);
      expect(second.body.runId).toBe(first.body.runId);
      const overlap = first.body.results
        .map((r: { externalJobId: string }) => r.externalJobId)
        .filter((id: string) =>
          second.body.results.some(
            (r: { externalJobId: string }) => r.externalJobId === id,
          ),
        );
      expect(overlap).toEqual([]);
    });

    it('returns the identical page twice', async () => {
      const once = await search(seekerToken, {
        query: MARKER,
        pageSize: 5,
        page: 2,
      }).expect(200);
      const twice = await search(seekerToken, {
        query: MARKER,
        pageSize: 5,
        page: 2,
      }).expect(200);
      expect(
        twice.body.results.map(
          (r: { externalJobId: string }) => r.externalJobId,
        ),
      ).toEqual(
        once.body.results.map(
          (r: { externalJobId: string }) => r.externalJobId,
        ),
      );
    });

    it('survives two concurrent identical searches', async () => {
      // The unique index is the real guarantee; this proves neither request
      // fails and both describe the same ranking.
      const [a, b] = await Promise.all([
        search(seekerToken, { query: `${MARKER} concurrent`, pageSize: 5 }),
        search(seekerToken, { query: `${MARKER} concurrent`, pageSize: 5 }),
      ]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.runId).toBe(b.body.runId);
    });
  });

  describe('the response contract', () => {
    it('carries the apply URL and clean provenance', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      const job = response.body.results.find(
        (r: { externalJobId: string }) => r.externalJobId === ids.active,
      );

      expect(job.applyUrl).toBe(
        `https://boards.zzfixture.invalid/${MARKER}/active`,
      );
      expect(job.provenance.sourceCount).toBe(1);
      expect(job.provenance.applyVia).toBe('GREENHOUSE');
      expect(job.score).toBeGreaterThanOrEqual(0);
      expect(['STRONG', 'GOOD', 'PARTIAL', 'LOW']).toContain(job.band);
    });

    it('creates no internal Application row for an external job', async () => {
      await search(seekerToken, { query: MARKER, pageSize: 100 }).expect(200);
      const applications = await prisma.application.count({
        where: { candidate: { candidateAccountId: seekerAccountId } },
      });
      expect(applications).toBe(0);
    });

    it('leaks no ingestion internals', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      const serialized = JSON.stringify(response.body.results);
      for (const leak of [
        'dedupeFingerprint',
        'payloadFingerprint',
        'sourceKey',
        'urlKeys',
        'claims',
        'sourceScope',
      ]) {
        expect(serialized).not.toContain(leak);
      }
    });

    it('states remote geography so a card need not guess it', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        pageSize: 100,
      }).expect(200);
      const byId = (key: string) =>
        response.body.results.find(
          (r: { externalJobId: string }) => r.externalJobId === ids[key],
        );

      // Stated: the UI may name the countries.
      expect(byId('remoteUsOnly').remoteCountriesAllowed).toEqual(['US']);
      // Unstated: empty, which the UI writes as "countries not stated" and
      // never as worldwide. The distinction only exists if it travels.
      expect(byId('remoteUnknown').remoteCountriesAllowed).toEqual([]);
    });
  });

  /**
   * Sorting by the employer's publication date (Task 4C.3).
   *
   * Against the real database, because the interesting parts are SQL: the
   * newest path takes its candidates from an index rather than from the
   * relevance funnel, and undated jobs have to stay reachable through a second
   * bounded query rather than being dropped by a `NULLS LAST` that no index
   * can serve.
   */
  describe('newest-first', () => {
    const ids2: Record<string, string> = {};

    beforeAll(async () => {
      // Three fixtures with known publication dates, plus the undated ones
      // every other test in this file already created.
      const dated = async (key: string, postedAt: string | null) => {
        await makeJob(`posted-${key}`, {
          title: `${MARKER} Posted ${key}`,
          normalizedTitle: `${MARKER} posted ${key}`,
          employerPostedAt: postedAt ? new Date(postedAt) : null,
        });
        ids2[key] = ids[`posted-${key}`];
      };
      await dated('newest', '2026-08-20T00:00:00Z');
      await dated('middle', '2026-05-01T00:00:00Z');
      await dated('oldest', '2026-01-05T00:00:00Z');
      await dated('undated', null);
    });

    it('orders by the employer date, newest first', async () => {
      const response = await search(seekerToken, {
        query: `${MARKER} Posted`,
        sort: 'NEWEST',
        pageSize: 100,
      }).expect(200);

      const order = mine(response.body).filter((id) =>
        Object.values(ids2).includes(id),
      );
      expect(order.slice(0, 3)).toEqual([
        ids2.newest,
        ids2.middle,
        ids2.oldest,
      ]);
    });

    it('keeps undated jobs reachable, after the dated ones', async () => {
      const response = await search(seekerToken, {
        query: `${MARKER} Posted`,
        sort: 'NEWEST',
        pageSize: 100,
      }).expect(200);

      const order = mine(response.body).filter((id) =>
        Object.values(ids2).includes(id),
      );
      // Present, and last. Not excluded, and not given an invented date that
      // would scatter them through the list.
      expect(order).toContain(ids2.undated);
      expect(order.indexOf(ids2.undated)).toBe(order.length - 1);
    });

    it('returns the publication date it sorted by', async () => {
      const response = await search(seekerToken, {
        query: `${MARKER} Posted`,
        sort: 'NEWEST',
        pageSize: 100,
      }).expect(200);

      const newest = response.body.results.find(
        (r: { externalJobId: string }) => r.externalJobId === ids2.newest,
      );
      expect(new Date(newest.employerPostedAt).toISOString()).toBe(
        '2026-08-20T00:00:00.000Z',
      );
      const undated = response.body.results.find(
        (r: { externalJobId: string }) => r.externalJobId === ids2.undated,
      );
      expect(undated.employerPostedAt).toBeNull();
    });

    it('echoes the order it applied', async () => {
      const relevance = await search(seekerToken, { query: MARKER }).expect(
        200,
      );
      const newest = await search(seekerToken, {
        query: MARKER,
        sort: 'NEWEST',
      }).expect(200);
      expect(relevance.body.sort).toBe('RELEVANCE');
      expect(newest.body.sort).toBe('NEWEST');
    });

    it('keeps the text query hard', async () => {
      // Newest WITHIN the matched universe. Not the newest jobs in the
      // catalogue with the query quietly dropped.
      const response = await search(seekerToken, {
        query: `${MARKER} Registered Nurse`,
        sort: 'NEWEST',
        pageSize: 100,
      }).expect(200);
      expect(mine(response.body)).toContain(ids.nurse);
      expect(mine(response.body)).not.toContain(ids2.newest);
    });

    it('keeps an explicit country hard, additionalLocations included', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        countries: ['CA'],
        sort: 'NEWEST',
        pageSize: 100,
      }).expect(200);
      const found = mine(response.body);
      // The job whose CANADIAN office is only in additionalLocations still
      // qualifies when the list is ordered by date.
      expect(found).toContain(ids.multiLocation);
      expect(found).not.toContain(ids.korean);
    });

    it('excludes everything outside the current universe', async () => {
      const response = await search(seekerToken, {
        query: MARKER,
        sort: 'NEWEST',
        pageSize: 100,
      }).expect(200);
      const found = mine(response.body);
      for (const key of ['closed', 'expired', 'unavailable']) {
        expect(found).not.toContain(ids[key]);
      }
      // STALE stays searchable in both orders.
      expect(found).toContain(ids.stale);
    });

    it('gives the two orders separate snapshots', async () => {
      const relevance = await search(seekerToken, { query: MARKER }).expect(
        200,
      );
      const newest = await search(seekerToken, {
        query: MARKER,
        sort: 'NEWEST',
      }).expect(200);
      // Different candidate sets, so sharing a stored run would serve one
      // order under the other's name.
      expect(newest.body.runId).not.toBe(relevance.body.runId);
    });

    it('reuses one snapshot for the same newest request', async () => {
      const first = await search(seekerToken, {
        query: MARKER,
        sort: 'NEWEST',
      }).expect(200);
      const second = await search(seekerToken, {
        query: MARKER,
        sort: 'NEWEST',
      }).expect(200);
      expect(second.body.runId).toBe(first.body.runId);
    });

    it('pages a newest run without duplicates or reordering', async () => {
      const seen: string[] = [];
      let runId: string | null = null;
      for (const page of [1, 2]) {
        const response = await search(seekerToken, {
          query: MARKER,
          sort: 'NEWEST',
          page,
          pageSize: 5,
        }).expect(200);
        runId = runId ?? response.body.runId;
        expect(response.body.runId).toBe(runId);
        seen.push(
          ...response.body.results.map(
            (r: { externalJobId: string }) => r.externalJobId,
          ),
        );
      }
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('refuses a sort it does not know', async () => {
      // A closed enum at the DTO. The string never reaches SQL — an
      // `ORDER BY ${sort}` is how a read-only search becomes an injection
      // surface.
      await search(seekerToken, {
        query: MARKER,
        sort: 'NEWEST; DROP TABLE external_jobs',
      }).expect(400);
      await search(seekerToken, { query: MARKER, sort: 'newest' }).expect(400);
      await search(seekerToken, { query: MARKER, sort: 'SALARY' }).expect(400);
    });

    it('leaves the relevance order untouched', async () => {
      // The regression this whole task must not cause: a search that did not
      // ask for a sort comes back exactly as it did before.
      const before = await search(seekerToken, {
        query: `${MARKER} Backend Engineer`,
        pageSize: 100,
      }).expect(200);
      const again = await search(seekerToken, {
        query: `${MARKER} Backend Engineer`,
        sort: 'RELEVANCE',
        pageSize: 100,
      }).expect(200);
      expect(
        again.body.results.map(
          (r: { externalJobId: string }) => r.externalJobId,
        ),
      ).toEqual(
        before.body.results.map(
          (r: { externalJobId: string }) => r.externalJobId,
        ),
      );
      expect(again.body.results.map((r: { score: number }) => r.score)).toEqual(
        before.body.results.map((r: { score: number }) => r.score),
      );
    });
  });

  /**
   * The detail read (Task 4C.2).
   *
   * A GET by id, added so a reader can see a description without shipping
   * twenty of them in every page of search results. It takes no ranking input
   * and returns no personalization, so what has to be proven here is that it
   * obeys the same universe rule and the same scope as the search — a second
   * door into the same room must not have a weaker lock.
   */
  describe('the detail read', () => {
    const detail = (token: string, id: string) =>
      request(http)
        .get(`/candidate-account/me/external-jobs/${id}`)
        .set('Authorization', `Bearer ${token}`);

    it('returns one job in full', async () => {
      const response = await detail(seekerToken, ids.active).expect(200);
      expect(response.body.externalJobId).toBe(ids.active);
      expect(response.body.title).toContain(MARKER);
      expect(response.body.description).toContain('Build and operate');
      expect(response.body.applyUrl).toBe(
        `https://boards.zzfixture.invalid/${MARKER}/active`,
      );
      expect(response.body.provenance.applyVia).toBe('GREENHOUSE');
    });

    it('keeps Korean unromanized', async () => {
      const response = await detail(seekerToken, ids.korean).expect(200);
      expect(response.body.title).toContain('백엔드 개발자');
      expect(response.body.description).toContain('백엔드 서비스');
      expect(response.body.location.city).toBe('서울');
    });

    it('reads every office the posting is open in', async () => {
      const response = await detail(seekerToken, ids.multiLocation).expect(200);
      expect(response.body.additionalLocations).toEqual([
        { countryCode: 'CA', region: 'Ontario', city: 'Toronto' },
        { countryCode: 'DE', region: null, city: 'Berlin' },
      ]);
    });

    it('obeys the same universe rule as the search', async () => {
      // A job that left the universe is a 404, not a rendered page with a dead
      // Apply button. Same predicate, same answer, from both doors.
      for (const key of ['closed', 'expired', 'unavailable']) {
        await detail(seekerToken, ids[key]).expect(404);
      }
      await detail(seekerToken, ids.stale).expect(200);
    });

    it('is candidate-scoped, like the search it belongs to', async () => {
      await request(http)
        .get(`/candidate-account/me/external-jobs/${ids.active}`)
        .expect(401);
      // A recruiter has no business reading a job seeker's surfaces, even one
      // that returns no personalization.
      await detail(recruiterToken, ids.active).expect(403);
    });

    it('refuses an id that is not an id before it queries anything', async () => {
      await detail(seekerToken, 'not-a-uuid').expect(400);
    });

    it('carries no score, band or reason', async () => {
      const response = await detail(seekerToken, ids.active).expect(200);
      // Personalization stays in the search, which is the only call that knows
      // who is asking. Two candidates open this job and read the same facts.
      for (const field of ['score', 'band', 'reasons', 'textScore', 'rank']) {
        expect(response.body).not.toHaveProperty(field);
      }
    });

    it('leaks no ingestion internals and no crawler timestamps', async () => {
      const response = await detail(seekerToken, ids.active).expect(200);
      const serialized = JSON.stringify(response.body);
      for (const leak of [
        'dedupeFingerprint',
        'sourceKey',
        'urlKeys',
        'claims',
        'sourceScope',
        'canonicalSourceId',
        'normalizedTitle',
        // Crawler freshness. Rendering it as "posted" would attribute our
        // sweep schedule to the employer.
        'lastSeenAt',
        'firstSeenAt',
        'lastVerifiedAt',
      ]) {
        expect(serialized).not.toContain(leak);
      }
    });

    it('creates no internal Application row', async () => {
      await detail(seekerToken, ids.active).expect(200);
      const applications = await prisma.application.count({
        where: { candidate: { candidateAccountId: seekerAccountId } },
      });
      expect(applications).toBe(0);
    });
  });
});
