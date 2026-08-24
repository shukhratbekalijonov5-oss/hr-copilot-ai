import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Candidate job preferences (e2e, real database).
 *
 * Proves over real HTTP what a mocked service cannot:
 *
 *  - the preference profile is OWNER-SCOPED — no route, body or query names an
 *    account, an organization account is refused outright, and an
 *    unauthenticated request never reaches a handler;
 *  - Rule N1 holds in Postgres: an edit REPLACES the profile, and the previous
 *    roles, locations and salary are gone from the tables — not merely absent
 *    from a response;
 *  - the shared job-intent resolver reflects a write immediately, and returns
 *    an empty intent once the profile is deleted;
 *  - an explicit search filter overrides a saved preference FOR THAT SEARCH
 *    without writing anything back.
 *
 * Fixtures are throwaway (unique suffix) and removed afterwards.
 */
describe('Candidate job preferences (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const run = Date.now().toString(36);
  const orgSlug = `e2e-prefs-${run}`;
  const seekerEmail = `prefs-seeker-${run}@e2e.test`;
  const otherSeekerEmail = `prefs-other-${run}@e2e.test`;
  const recruiterEmail = `prefs-recruiter-${run}@e2e.test`;
  const PASSWORD = 'CorrectHorseBattery1!';

  let seekerToken: string;
  let otherToken: string;
  let recruiterToken: string;
  let seekerAccountId: string;

  const PREFERENCES = '/candidate-account/me/job-preferences';

  const put = (token: string, body: Record<string, unknown>) =>
    request(http)
      .put(PREFERENCES)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const get = (token: string) =>
    request(http).get(PREFERENCES).set('Authorization', `Bearer ${token}`);

  const INITIAL = {
    preferredJobTitles: ['DevOps Engineer', 'Platform Engineer'],
    preferredLocations: [
      { countryCode: 'KR', city: 'Seoul' },
      { countryCode: 'KR', city: 'Busan' },
    ],
    preferredWorkModes: ['REMOTE', 'HYBRID'],
    preferredEmploymentTypes: ['FULL_TIME'],
    preferredSeniorityLevels: ['MID', 'SENIOR'],
    desiredSalaryMin: 50_000_000,
    salaryCurrency: 'KRW',
    payPeriod: 'YEARLY',
    willingToRelocate: true,
    preferredIndustries: ['Technology', 'Fintech'],
  };

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
      fullName: 'Prefs Seeker',
      email: seekerEmail,
      password: PASSWORD,
    });
    seekerToken = seeker.body.accessToken;

    const other = await request(http).post('/auth/register/candidate').send({
      fullName: 'Prefs Other',
      email: otherSeekerEmail,
      password: PASSWORD,
    });
    otherToken = other.body.accessToken;

    const recruiter = await request(http)
      .post('/auth/register/organization')
      .send({
        organizationName: 'E2E Prefs Org',
        organizationSlug: orgSlug,
        fullName: 'Prefs Recruiter',
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
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: orgSlug } });
    await prisma.user.deleteMany({
      where: { email: { in: [seekerEmail, otherSeekerEmail, recruiterEmail] } },
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
      await request(http).get(PREFERENCES).expect(401);
      await request(http).put(PREFERENCES).send({}).expect(401);
      await request(http).delete(PREFERENCES).expect(401);
    });

    it('rejects an ORGANIZATION account', async () => {
      // A recruiter has no job preferences; this surface is not theirs.
      await get(recruiterToken).expect(403);
      await put(recruiterToken, {}).expect(403);
    });

    it('refuses a client-supplied account id outright', async () => {
      const response = await put(seekerToken, {
        candidateAccountId: 'someone-else',
        preferredJobTitles: ['SRE'],
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('candidateAccountId');
    });

    it('never shows one candidate another candidate’s preferences', async () => {
      await put(seekerToken, INITIAL).expect(200);

      // The other seeker's own view is empty — there is no id to substitute,
      // so the only thing they can ask for is their own.
      const other = await get(otherToken).expect(200);
      expect(other.body.stated).toBe(false);
      expect(other.body.preferredJobTitles).toEqual([]);
    });
  });

  describe('Rule N1 — one current version in the database', () => {
    it('starts with nothing stated', async () => {
      const response = await get(seekerToken).expect(200);
      expect(response.body.stated).toBe(false);
      expect(response.body.desiredSalaryMin).toBeNull();
      expect(response.body.willingToRelocate).toBeNull();
    });

    it('replaces roles, locations and salary, leaving no previous rows', async () => {
      await put(seekerToken, INITIAL).expect(200);

      const before = await prisma.candidatePreferredLocation.findMany({
        where: { preferences: { candidateAccountId: seekerAccountId } },
      });
      expect(before).toHaveLength(2);

      await put(seekerToken, {
        ...INITIAL,
        preferredJobTitles: ['DevOps Engineer', 'Cloud Engineer'],
        preferredLocations: [
          { countryCode: 'CA', region: 'Ontario', city: 'Toronto' },
        ],
        desiredSalaryMin: 70_000,
        salaryCurrency: 'CAD',
        willingToRelocate: false,
      }).expect(200);

      // The proof is in the TABLES, not the response: a merge would leave the
      // Seoul row alive and still retrievable as current intent.
      const rows = await prisma.candidatePreferredLocation.findMany({
        where: { preferences: { candidateAccountId: seekerAccountId } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ countryCode: 'CA', city: 'Toronto' });

      const stored = await prisma.candidateJobPreferences.findUniqueOrThrow({
        where: { candidateAccountId: seekerAccountId },
      });
      expect(stored.preferredJobTitles).toEqual([
        'DevOps Engineer',
        'Cloud Engineer',
      ]);
      expect(stored.preferredJobTitles).not.toContain('Platform Engineer');
      expect(stored.salaryCurrency).toBe('CAD');
      expect(stored.willingToRelocate).toBe(false);
    });

    it('clears the whole compensation preference together', async () => {
      await put(seekerToken, INITIAL).expect(200);
      await put(seekerToken, {
        ...INITIAL,
        desiredSalaryMin: null,
        salaryCurrency: null,
        payPeriod: null,
      }).expect(200);

      const stored = await prisma.candidateJobPreferences.findUniqueOrThrow({
        where: { candidateAccountId: seekerAccountId },
      });
      expect(stored.desiredSalaryMin).toBeNull();
      // Not just the amount — a stale KRW/YEARLY would still be readable.
      expect(stored.salaryCurrency).toBeNull();
      expect(stored.payPeriod).toBeNull();
    });

    it('deletes the profile and its locations completely', async () => {
      await put(seekerToken, INITIAL).expect(200);
      await request(http)
        .delete(PREFERENCES)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(200);

      expect(
        await prisma.candidateJobPreferences.findUnique({
          where: { candidateAccountId: seekerAccountId },
        }),
      ).toBeNull();
      expect(
        await prisma.candidatePreferredLocation.count({
          where: { preferences: { candidateAccountId: seekerAccountId } },
        }),
      ).toBe(0);

      const after = await get(seekerToken).expect(200);
      expect(after.body.stated).toBe(false);
    });
  });

  describe('validation at the HTTP boundary', () => {
    it('rejects a country name, an unknown currency and a bad enum', async () => {
      await put(seekerToken, {
        preferredLocations: [{ countryCode: 'South Korea' }],
      }).expect(400);
      await put(seekerToken, {
        desiredSalaryMin: 1,
        salaryCurrency: 'won',
        payPeriod: 'YEARLY',
      }).expect(400);
      await put(seekerToken, { preferredWorkModes: ['ANYWHERE'] }).expect(400);
      await put(seekerToken, { desiredSalaryMin: -5 }).expect(400);
    });

    it('rejects an amount without the units that make it comparable', async () => {
      await put(seekerToken, { desiredSalaryMin: 50_000_000 }).expect(400);
      await put(seekerToken, {
        desiredSalaryMin: 50_000_000,
        salaryCurrency: 'KRW',
      }).expect(400);
    });
  });

  describe('the shared search context', () => {
    const context = (token: string, query = '') =>
      request(http)
        .get(`${PREFERENCES}/search-context${query}`)
        .set('Authorization', `Bearer ${token}`);

    it('reflects a write immediately', async () => {
      await put(seekerToken, INITIAL).expect(200);

      const response = await context(seekerToken).expect(200);
      expect(response.body.jobIntent.stated).toBe(true);
      expect(response.body.jobIntent.countries).toEqual(['KR']);
      expect(response.body.resolved.countries).toEqual({
        value: ['KR'],
        source: 'PREFERENCE',
      });
    });

    it('lets an explicit filter override the saved default without saving it', async () => {
      await put(seekerToken, INITIAL).expect(200);

      const response = await context(
        seekerToken,
        '?countries=DE&query=Senior%20Backend%20Engineer',
      ).expect(200);

      // Berlin is not rejected for disagreeing with the saved country…
      expect(response.body.resolved.countries).toEqual({
        value: ['DE'],
        source: 'REQUEST',
      });
      // …and the untouched dimension keeps the saved default.
      expect(response.body.resolved.workModes.source).toBe('PREFERENCE');

      // Searching is not a preference update.
      const stored = await prisma.candidateJobPreferences.findUniqueOrThrow({
        where: { candidateAccountId: seekerAccountId },
      });
      const countries = await prisma.candidatePreferredLocation.findMany({
        where: { preferencesId: stored.id },
        select: { countryCode: true },
      });
      expect(countries.map((c) => c.countryCode)).toEqual(['KR', 'KR']);
    });

    it('returns an empty, well-formed intent after deletion', async () => {
      await put(seekerToken, INITIAL).expect(200);
      await request(http)
        .delete(PREFERENCES)
        .set('Authorization', `Bearer ${seekerToken}`)
        .expect(200);

      const response = await context(seekerToken).expect(200);
      expect(response.body.jobIntent.stated).toBe(false);
      expect(response.body.jobIntent.countries).toEqual([]);
      // UNSPECIFIED is "no restriction", never "reject everything".
      expect(response.body.resolved.countries.source).toBe('UNSPECIFIED');
    });
  });
});
