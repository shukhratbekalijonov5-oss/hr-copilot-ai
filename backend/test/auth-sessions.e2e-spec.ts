import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Refresh-session layer, end to end against the REAL database over real HTTP:
 * rotation, reuse detection, logout / logout-all, concurrent devices,
 * cross-user session isolation, candidate-only and multi-org refresh, and
 * membership staleness. Also verifies at the DATABASE level that only hashes
 * are ever stored.
 *
 * The throttler guard is disabled for this suite only — it would otherwise
 * rate-limit the many logins these scenarios legitimately need; throttling
 * itself is not under test here.
 */
describe('Auth sessions (e2e, real database)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let jwt: JwtService;
  let secret: string;

  const run = Date.now().toString(36);
  const PASSWORD = 'CorrectHorseBattery1!';
  const orgASlug = `sess-org-a-${run}`;
  const orgBSlug = `sess-org-b-${run}`;
  const ownerAEmail = `sess-owner-a-${run}@e2e.test`;
  const ownerBEmail = `sess-owner-b-${run}@e2e.test`;
  const seekerEmail = `sess-seeker-${run}@e2e.test`;
  const multiEmail = `sess-multi-${run}@e2e.test`;
  const doomedEmail = `sess-doomed-${run}@e2e.test`;
  const allEmails = [
    ownerAEmail,
    ownerBEmail,
    seekerEmail,
    multiEmail,
    doomedEmail,
  ];

  const registerOrganization = (body: Record<string, unknown>) =>
    request(http).post('/auth/register/organization').send(body);
  const registerCandidate = (body: Record<string, unknown>) =>
    request(http).post('/auth/register/candidate').send(body);
  const login = (email: string, deviceName?: string) =>
    request(http)
      .post('/auth/login')
      .send({
        email,
        password: PASSWORD,
        ...(deviceName ? { deviceName } : {}),
      });
  const refresh = (refreshToken: string) =>
    request(http).post('/auth/refresh').send({ refreshToken });
  const authed = (
    method: 'get' | 'post' | 'delete',
    path: string,
    token: string,
  ) => request(http)[method](path).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Neutralize rate limiting by overriding the throttler's STORAGE (the
      // guard is bound via APP_GUARD and cannot be replaced by class token).
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 0,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .compile();

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
    jwt = app.get(JwtService);
    secret = app.get(ConfigService).getOrThrow<string>('auth.secretToken');
    http = app.getHttpServer();

    // Cast of this suite. Multi-org user: RECRUITER in A, INTERVIEWER in B —
    // an ORGANIZATION account created by org A's invite (account types are
    // exclusive now, so members enter through registration-with-org or an
    // invitation, never as converted candidates).
    await registerOrganization({
      organizationName: `Sess Org A ${run}`,
      organizationSlug: orgASlug,
      fullName: 'Session Owner A',
      email: ownerAEmail,
      password: PASSWORD,
    }).expect(201);
    await registerOrganization({
      organizationName: `Sess Org B ${run}`,
      organizationSlug: orgBSlug,
      fullName: 'Session Owner B',
      email: ownerBEmail,
      password: PASSWORD,
    }).expect(201);
    await registerCandidate({
      fullName: 'Session Seeker',
      email: seekerEmail,
      password: PASSWORD,
      preferredLocale: 'ko',
    }).expect(201);

    const ownerA = await login(ownerAEmail);
    const ownerB = await login(ownerBEmail);
    // First invite CREATES the account (this password is the real one)…
    await authed('post', '/auth/users', ownerA.body.accessToken as string)
      .send({
        fullName: 'Multi Org Person',
        email: multiEmail,
        password: PASSWORD,
        role: 'RECRUITER',
      })
      .expect(201);
    // …the second one only adds a membership (password ignored).
    await authed('post', '/auth/users', ownerB.body.accessToken as string)
      .send({
        fullName: 'Multi Org Person',
        email: multiEmail,
        password: 'IgnoredForExisting1!',
        role: 'INTERVIEWER',
      })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { slug: { in: [orgASlug, orgBSlug] } },
    });
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
    await app.close();
  });

  describe('auth basics + database truths', () => {
    it('login creates an AuthSession row that stores a hash, never the raw token', async () => {
      const res = await login(seekerEmail, 'Pixel 9 Pro');
      expect(res.status).toBe(200);
      const { accessToken, refreshToken } = res.body as {
        accessToken: string;
        refreshToken: string;
      };
      expect(refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{40,}$/);

      // The access token works and names its session.
      const me = await authed('get', '/auth/me', accessToken).expect(200);
      expect(me.body.user.email).toBe(seekerEmail);
      const sid = jwt.decode(accessToken).sid;

      // REAL DATABASE: row exists; only a hash is stored; the raw secret
      // appears nowhere in the row.
      const row = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid },
      });
      const rawSecret = refreshToken.split('.')[1];
      expect(row.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(rawSecret);
      expect(row.deviceName).toBe('Pixel 9 Pro');
      expect(row.revokedAt).toBeNull();
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects a malformed access token', async () => {
      await authed('get', '/auth/me', 'not-a-jwt').expect(401);
    });

    it('rejects an expired access token', async () => {
      const expired = jwt.sign(
        { sub: 'user-x', email: 'x@e2e.test' },
        { secret, expiresIn: '-1s' },
      );
      await authed('get', '/auth/me', expired).expect(401);
    });
  });

  describe('refresh rotation and reuse', () => {
    it('rotates: new tokens work, DB hash changes, old hash becomes previous', async () => {
      const first = (await login(seekerEmail)).body as {
        accessToken: string;
        refreshToken: string;
      };
      const sid = jwt.decode(first.accessToken).sid;
      const before = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid },
      });

      const rotated = await refresh(first.refreshToken).expect(200);
      expect(rotated.body.refreshToken).not.toBe(first.refreshToken);
      // Same session, fresh access token.
      expect(jwt.decode(rotated.body.accessToken).sid).toBe(sid);
      await authed('get', '/auth/me', rotated.body.accessToken).expect(200);

      const after = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid },
      });
      expect(after.refreshTokenHash).not.toBe(before.refreshTokenHash);
      expect(after.previousTokenHash).toBe(before.refreshTokenHash);
      expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime()); // absolute, never extended
    });

    it('REUSING the pre-rotation token revokes the session — and kills the newer token too', async () => {
      const first = (await login(seekerEmail)).body;
      const rotated = (await refresh(first.refreshToken).expect(200)).body;

      const reuse = await refresh(first.refreshToken).expect(401);
      expect(reuse.body.code).toBe('AUTH_REFRESH_TOKEN_REUSED');

      // Fail-secure: the legitimate successor token is dead as well.
      const successor = await refresh(rotated.refreshToken).expect(401);
      expect(successor.body.code).toBe('AUTH_SESSION_REVOKED');

      const sid = jwt.decode(first.accessToken as string).sid;
      const row = await prisma.authSession.findUniqueOrThrow({
        where: { id: sid },
      });
      expect(row.revokedAt).not.toBeNull();
    });

    it('malformed and unknown refresh tokens are uniform 401s', async () => {
      const garbage = await refresh('definitely-not-a-refresh-token').expect(
        401,
      );
      expect(garbage.body.code).toBe('AUTH_INVALID_REFRESH_TOKEN');

      const unknown = await refresh(
        `00000000-0000-4000-8000-000000000000.${'a'.repeat(43)}`,
      ).expect(401);
      expect(unknown.body.code).toBe('AUTH_INVALID_REFRESH_TOKEN');
    });

    it('an expired session refuses to refresh', async () => {
      const s = (await login(seekerEmail)).body;
      const sid = jwt.decode(s.accessToken as string).sid;
      await prisma.authSession.update({
        where: { id: sid },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await refresh(s.refreshToken as string).expect(401);
      expect(res.body.code).toBe('AUTH_REFRESH_TOKEN_EXPIRED');
    });

    it('a deleted user cannot refresh (session cascades away with the account)', async () => {
      await registerCandidate({
        fullName: 'Doomed User',
        email: doomedEmail,
        password: PASSWORD,
      }).expect(201);
      const s = (await login(doomedEmail)).body;
      await prisma.user.delete({ where: { email: doomedEmail } });

      const res = await refresh(s.refreshToken as string).expect(401);
      expect(res.body.code).toBe('AUTH_INVALID_REFRESH_TOKEN');
    });
  });

  describe('logout and logout-all', () => {
    it('logout revokes ONLY the current session; another device stays signed in', async () => {
      const deviceA = (await login(seekerEmail, 'Device A')).body;
      const deviceB = (await login(seekerEmail, 'Device B')).body;

      await authed(
        'post',
        '/auth/logout',
        deviceA.accessToken as string,
      ).expect(200);

      const deadRefresh = await refresh(deviceA.refreshToken as string).expect(
        401,
      );
      expect(deadRefresh.body.code).toBe('AUTH_SESSION_REVOKED');
      // Device B is untouched.
      await refresh(deviceB.refreshToken as string).expect(200);
    });

    it('logout-all revokes every session; every previous refresh token fails', async () => {
      const s1 = (await login(seekerEmail)).body;
      const s2 = (await login(seekerEmail)).body;
      const s3 = (await login(seekerEmail)).body;

      const res = await authed(
        'post',
        '/auth/logout-all',
        s3.accessToken as string,
      ).expect(200);
      expect(res.body.revokedSessions).toBeGreaterThanOrEqual(3);

      for (const s of [s1, s2, s3]) {
        const dead = await refresh(s.refreshToken as string).expect(401);
        expect(dead.body.code).toBe('AUTH_SESSION_REVOKED');
      }
      // REAL DATABASE: revocation persisted for every session of the user.
      const live = await prisma.authSession.count({
        where: { user: { email: seekerEmail }, revokedAt: null },
      });
      expect(live).toBe(0);
    });
  });

  describe('concurrent devices and session management', () => {
    it('two sessions refresh independently; revoking one never touches the other', async () => {
      let a = (await login(seekerEmail, 'Laptop')).body;
      let b = (await login(seekerEmail, 'Phone')).body;

      a = (await refresh(a.refreshToken as string).expect(200)).body;
      b = (await refresh(b.refreshToken as string).expect(200)).body;

      const sidA = jwt.decode(a.accessToken as string).sid;
      const sidB = jwt.decode(b.accessToken as string).sid;

      // Remote sign-out of A from B's session.
      await authed(
        'delete',
        `/auth/sessions/${sidA}`,
        b.accessToken as string,
      ).expect(200);
      const deadA = await refresh(a.refreshToken as string).expect(401);
      expect(deadA.body.code).toBe('AUTH_SESSION_REVOKED');
      b = (await refresh(b.refreshToken as string).expect(200)).body;

      // And the mirror image: B revokes itself, sidB listed as gone.
      await authed(
        'delete',
        `/auth/sessions/${sidB}`,
        b.accessToken as string,
      ).expect(200);
      await refresh(b.refreshToken as string).expect(401);
    });

    it('GET /auth/sessions lists only own live sessions, flags the current one, leaks no hashes', async () => {
      const s1 = (await login(seekerEmail, 'Tablet')).body;
      await login(seekerEmail, 'Desk');

      const res = await authed(
        'get',
        '/auth/sessions',
        s1.accessToken as string,
      ).expect(200);

      const sessions = res.body as Record<string, unknown>[];
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      const sid = jwt.decode(s1.accessToken as string).sid;
      expect(sessions.find((s) => s.id === sid)?.current).toBe(true);
      for (const s of sessions) {
        expect(s).not.toHaveProperty('refreshTokenHash');
        expect(s).not.toHaveProperty('previousTokenHash');
        expect(s).not.toHaveProperty('userId');
      }
    });

    it('cross-user session isolation: A cannot see or revoke B sessions', async () => {
      const seeker = (await login(seekerEmail)).body;
      const ownerA = (await login(ownerAEmail)).body;
      const ownerSid = jwt.decode(ownerA.accessToken as string).sid;

      const list = await authed(
        'get',
        '/auth/sessions',
        seeker.accessToken as string,
      ).expect(200);
      expect(
        (list.body as { id: string }[]).some((s) => s.id === ownerSid),
      ).toBe(false);

      const kill = await authed(
        'delete',
        `/auth/sessions/${ownerSid}`,
        seeker.accessToken as string,
      ).expect(404);
      expect(kill.body.code).toBe('AUTH_SESSION_NOT_FOUND');
      // Owner A is untouched.
      await refresh(ownerA.refreshToken as string).expect(200);
    });
  });

  describe('candidate-only users', () => {
    it('login → refresh → candidate routes → logout, with no organization anywhere', async () => {
      const first = (await login(seekerEmail)).body;
      expect(first.user.organizationId).toBeNull();
      expect(jwt.decode(first.accessToken as string).org).toBeUndefined();

      const rotated = (await refresh(first.refreshToken as string).expect(200))
        .body;
      expect(rotated.user.role).toBeNull();

      // Candidate self-service works on the post-refresh access token (the
      // profile itself was created at signup).
      await request(http)
        .patch('/candidate-account/me')
        .set('Authorization', `Bearer ${rotated.accessToken as string}`)
        .send({ headline: '세션 테스트' })
        .expect(200);
      await authed(
        'get',
        '/candidate-account/me',
        rotated.accessToken as string,
      ).expect(200);
      // Org-scoped recruiter routes stay closed.
      await authed('get', '/vacancies', rotated.accessToken as string).expect(
        403,
      );

      await authed(
        'post',
        '/auth/logout',
        rotated.accessToken as string,
      ).expect(200);
      await refresh(rotated.refreshToken as string).expect(401);
    });
  });

  describe('multi-org refresh and organization switching', () => {
    it('refresh preserves the switched workspace; roles stay live per org', async () => {
      // Login: default active org = oldest membership (org A, RECRUITER).
      let s = (await login(multiEmail)).body;
      expect(s.user.role).toBe('RECRUITER');
      const orgAId = s.user.organizationId as string;

      // RECRUITER in org A may create vacancies.
      await authed('post', '/vacancies', s.accessToken as string)
        .send({ title: 'Sess Vacancy A' })
        .expect(201);

      // Refresh: workspace context (org A) survives rotation.
      s = (await refresh(s.refreshToken as string).expect(200)).body;
      expect(jwt.decode(s.accessToken as string).org).toBe(orgAId);
      await authed('post', '/vacancies', s.accessToken as string)
        .send({ title: 'Sess Vacancy A2' })
        .expect(201);

      // Switch to org B — same session, same refresh token, new access token.
      const me = await authed(
        'get',
        '/auth/me',
        s.accessToken as string,
      ).expect(200);
      const orgBId = (
        me.body.memberships as { organization: { id: string }; role: string }[]
      ).find((m) => m.role === 'INTERVIEWER')!.organization.id;
      const switched = await authed(
        'post',
        '/auth/switch-organization',
        s.accessToken as string,
      )
        .send({ organizationId: orgBId })
        .expect(200);
      expect(switched.body).not.toHaveProperty('refreshToken');
      expect(switched.body.activeOrganization.role).toBe('INTERVIEWER');

      // Refresh AFTER the switch: the new access token points at org B…
      const rotated = (await refresh(s.refreshToken as string).expect(200))
        .body;
      expect(jwt.decode(rotated.accessToken as string).org).toBe(orgBId);
      // …and the live role there is INTERVIEWER: reads yes, writes no.
      expect(rotated.user.role).toBe('INTERVIEWER');
      await authed('get', '/vacancies', rotated.accessToken as string).expect(
        200,
      );
      await authed('post', '/vacancies', rotated.accessToken as string)
        .send({ title: 'Nope' })
        .expect(403);
    });
  });

  describe('membership staleness beats every token', () => {
    it('demotion applies to un-expired access tokens instantly; removal degrades refresh to org-less', async () => {
      const ownerA = (await login(ownerAEmail)).body;
      let multi = (await login(multiEmail)).body; // active org A, RECRUITER

      // Sanity: can create vacancies right now.
      await authed('post', '/vacancies', multi.accessToken as string)
        .send({ title: 'Pre-demotion' })
        .expect(201);

      // Demote RECRUITER -> INTERVIEWER in org A.
      const multiUserId = multi.user.id as string;
      await request(http)
        .patch(`/users/${multiUserId}`)
        .set('Authorization', `Bearer ${ownerA.accessToken as string}`)
        .send({ role: 'INTERVIEWER' })
        .expect(200);

      // SAME access token, not expired — old privilege is already gone.
      await authed('post', '/vacancies', multi.accessToken as string)
        .send({ title: 'Post-demotion' })
        .expect(403);
      await authed('get', '/vacancies', multi.accessToken as string).expect(
        200,
      );

      // Remove the membership entirely.
      await request(http)
        .delete(`/users/${multiUserId}`)
        .set('Authorization', `Bearer ${ownerA.accessToken as string}`)
        .expect(200);

      // Old access token cannot reach org A at all any more.
      await authed('get', '/vacancies', multi.accessToken as string).expect(
        403,
      );

      // Refresh still works (the PERSON is fine) but degrades to org-less:
      // the session's stale org-A context is dropped, not honoured.
      multi = (await refresh(multi.refreshToken as string).expect(200)).body;
      expect(jwt.decode(multi.accessToken as string).org).toBeUndefined();
      expect(multi.user.role).toBeNull();
      // They can still switch to org B, where they remain a member.
      const meAfter = await authed(
        'get',
        '/auth/me',
        multi.accessToken as string,
      ).expect(200);
      expect(meAfter.body.memberships).toHaveLength(1);
      expect(meAfter.body.memberships[0].role).toBe('INTERVIEWER');
    });
  });
});
