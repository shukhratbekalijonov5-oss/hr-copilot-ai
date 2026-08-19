import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuthSessionService } from './auth-session.service';
import type { PrismaService } from '../prisma/prisma.service';

const USER = 'user-1';

const configService = {
  get: jest.fn((_: string, fallback?: unknown) => fallback),
} as unknown as ConfigService;

function createPrismaMock() {
  return {
    authSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

const sha256 = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');

/** Reads the `code` field out of the thrown 401 body. */
const codeOf = (error: unknown) =>
  (error as UnauthorizedException).getResponse() as { code?: string };

describe('AuthSessionService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: AuthSessionService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AuthSessionService(
      prisma as unknown as PrismaService,
      configService,
    );
  });

  describe('createSession', () => {
    it('stores ONLY a hash — never the raw secret', async () => {
      prisma.authSession.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'sess-1', ...data }),
      );

      const { refreshToken } = await service.createSession(USER, {
        userAgent: 'jest',
        deviceName: 'Unit Device',
      });

      const stored = prisma.authSession.create.mock.calls[0][0].data;
      const secret = refreshToken.split('.')[1];
      expect(secret.length).toBeGreaterThanOrEqual(40); // 256 bits base64url
      expect(stored.refreshTokenHash).toBe(sha256(secret));
      expect(stored.refreshTokenHash).not.toContain(secret);
      expect(JSON.stringify(stored)).not.toContain(secret);
    });

    it('sets an absolute expiry ~30 days out by default', async () => {
      prisma.authSession.create.mockImplementation(
        ({ data }: { data: { expiresAt: Date } }) =>
          Promise.resolve({ id: 'sess-1', ...data }),
      );

      await service.createSession(USER);

      const expiresAt = prisma.authSession.create.mock.calls[0][0].data
        .expiresAt as Date;
      const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
    });
  });

  describe('rotate', () => {
    const SECRET = 'a'.repeat(43);
    const OLD_SECRET = 'b'.repeat(43);
    const SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const liveSession = (overrides: Record<string, unknown> = {}) => ({
      id: SESSION_ID,
      userId: USER,
      refreshTokenHash: sha256(SECRET),
      previousTokenHash: sha256(OLD_SECRET),
      activeOrganizationId: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      ...overrides,
    });

    it('accepts the current token, rotates the hash and keeps the old one as previous', async () => {
      const session = liveSession();
      prisma.authSession.findUnique.mockResolvedValue(session);
      prisma.authSession.findUniqueOrThrow.mockResolvedValue(session);

      const { refreshToken } = await service.rotate(`${SESSION_ID}.${SECRET}`);

      const update = prisma.authSession.updateMany.mock.calls[0][0];
      // Guarded write: only rotates if nothing rotated it concurrently.
      expect(update.where).toEqual({
        id: SESSION_ID,
        refreshTokenHash: sha256(SECRET),
        revokedAt: null,
      });
      expect(update.data.previousTokenHash).toBe(sha256(SECRET));
      const newSecret = refreshToken.split('.')[1];
      expect(update.data.refreshTokenHash).toBe(sha256(newSecret));
      expect(newSecret).not.toBe(SECRET);
      expect(refreshToken.startsWith(`${SESSION_ID}.`)).toBe(true);
    });

    it('REUSE of the rotated-away token revokes the whole session', async () => {
      prisma.authSession.findUnique.mockResolvedValue(liveSession());

      const error = await service
        .rotate(`${SESSION_ID}.${OLD_SECRET}`)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(codeOf(error).code).toBe('AUTH_REFRESH_TOKEN_REUSED');
      expect(prisma.authSession.update).toHaveBeenCalledWith({
        where: { id: SESSION_ID },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('a WRONG secret is a plain 401 and must NOT revoke the session (no revocation-by-guessing)', async () => {
      prisma.authSession.findUnique.mockResolvedValue(liveSession());

      const error = await service
        .rotate(`${SESSION_ID}.${'z'.repeat(43)}`)
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('AUTH_INVALID_REFRESH_TOKEN');
      expect(prisma.authSession.update).not.toHaveBeenCalled();
      expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
    });

    it('a revoked session cannot refresh, even with the current secret', async () => {
      prisma.authSession.findUnique.mockResolvedValue(
        liveSession({ revokedAt: new Date() }),
      );

      const error = await service
        .rotate(`${SESSION_ID}.${SECRET}`)
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('AUTH_SESSION_REVOKED');
    });

    it('an expired session cannot refresh (absolute lifetime, rotation never extended it)', async () => {
      prisma.authSession.findUnique.mockResolvedValue(
        liveSession({ expiresAt: new Date(Date.now() - 1000) }),
      );

      const error = await service
        .rotate(`${SESSION_ID}.${SECRET}`)
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('AUTH_REFRESH_TOKEN_EXPIRED');
    });

    it.each([
      ['garbage', 'not-a-token'],
      ['missing secret', `${SESSION_ID}.`],
      ['missing session id', `.${'a'.repeat(43)}`],
      ['non-uuid session id', `nope.${'a'.repeat(43)}`],
      ['oversized', 'x'.repeat(600)],
    ])(
      'malformed token (%s) is a uniform invalid-token 401',
      async (_, raw) => {
        const error = await service.rotate(raw).catch((e: unknown) => e);

        expect(codeOf(error).code).toBe('AUTH_INVALID_REFRESH_TOKEN');
        expect(prisma.authSession.findUnique).not.toHaveBeenCalled();
      },
    );

    it('an unknown session id is indistinguishable from a malformed token', async () => {
      prisma.authSession.findUnique.mockResolvedValue(null);

      const error = await service
        .rotate(`${SESSION_ID}.${SECRET}`)
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('AUTH_INVALID_REFRESH_TOKEN');
    });

    it('loses the race gracefully when a concurrent refresh rotated first', async () => {
      const session = liveSession();
      prisma.authSession.findUnique.mockResolvedValue(session);
      prisma.authSession.updateMany.mockResolvedValue({ count: 0 });

      const error = await service
        .rotate(`${SESSION_ID}.${SECRET}`)
        .catch((e: unknown) => e);

      expect(codeOf(error).code).toBe('AUTH_INVALID_REFRESH_TOKEN');
    });
  });

  describe('ownership and revocation', () => {
    it('revokeOwned always filters by the CALLER, so foreign sessions 404', async () => {
      prisma.authSession.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.revokeOwned(USER, 'someone-elses-session'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.authSession.updateMany.mock.calls[0][0].where).toEqual({
        id: 'someone-elses-session',
        userId: USER,
        revokedAt: null,
      });
    });

    it('listForUser returns only live sessions, flags the current one, and never selects hashes', async () => {
      prisma.authSession.findMany.mockResolvedValue([
        { id: 'sess-1' },
        { id: 'sess-2' },
      ]);

      const result = await service.listForUser(USER, 'sess-2');

      const query = prisma.authSession.findMany.mock.calls[0][0];
      expect(query.where).toMatchObject({ userId: USER, revokedAt: null });
      expect(query.select).not.toHaveProperty('refreshTokenHash');
      expect(query.select).not.toHaveProperty('previousTokenHash');
      expect(result).toEqual([
        { id: 'sess-1', current: false },
        { id: 'sess-2', current: true },
      ]);
    });

    it('revokeAllForUser hits every live session of that user only', async () => {
      prisma.authSession.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.revokeAllForUser(USER)).resolves.toBe(3);
      expect(prisma.authSession.updateMany.mock.calls[0][0].where).toEqual({
        userId: USER,
        revokedAt: null,
      });
    });
  });
});
