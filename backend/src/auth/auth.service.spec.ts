import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { Role } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';

const CONFIG: Record<string, unknown> = {
  'auth.secretToken': 'test-secret-token-that-is-long-enough-32',
  'auth.tokenTtl': '1d',
  'auth.bcryptRounds': 4, // Keep the suite fast.
};

function createConfigMock(): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => CONFIG[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in CONFIG)) throw new Error(`missing ${key}`);
      return CONFIG[key];
    }),
  } as unknown as ConfigService;
}

function createPrismaMock() {
  return {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    organization: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('AuthService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwtService: JwtService;
  let service: AuthService;

  beforeEach(() => {
    prisma = createPrismaMock();
    jwtService = new JwtService({
      secret: CONFIG['auth.secretToken'] as string,
    });
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      createConfigMock(),
    );
  });

  const registerDto = {
    organizationName: 'Northwind Labs',
    organizationSlug: 'northwind-labs',
    fullName: 'Dana Whitfield',
    email: 'Dana@Northwind-Labs.test',
    password: 'CorrectHorseBattery1',
  };

  describe('register', () => {
    it('creates the organization and an OWNER, and returns a token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn({
          organization: {
            create: jest.fn().mockResolvedValue({ id: 'org-1' }),
          },
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'user-1',
              email: 'dana@northwind-labs.test',
              fullName: 'Dana Whitfield',
              role: Role.OWNER,
              organizationId: 'org-1',
            }),
          },
        }),
      );

      const result = await service.register(registerDto);

      expect(result.user.role).toBe(Role.OWNER);
      expect(result.user.organizationId).toBe('org-1');
      expect(result.accessToken).toEqual(expect.any(String));
    });

    it('normalises the email to lowercase before storing it', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      const createUser = jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'dana@northwind-labs.test',
        fullName: 'Dana Whitfield',
        role: Role.OWNER,
        organizationId: 'org-1',
      });
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn({
          organization: {
            create: jest.fn().mockResolvedValue({ id: 'org-1' }),
          },
          user: { create: createUser },
        }),
      );

      await service.register(registerDto);

      expect(createUser.mock.calls[0][0].data.email).toBe(
        'dana@northwind-labs.test',
      );
    });

    it('stores a bcrypt hash, never the plaintext password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      const createUser = jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'dana@northwind-labs.test',
        fullName: 'Dana Whitfield',
        role: Role.OWNER,
        organizationId: 'org-1',
      });
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn({
          organization: {
            create: jest.fn().mockResolvedValue({ id: 'org-1' }),
          },
          user: { create: createUser },
        }),
      );

      await service.register(registerDto);

      const stored = createUser.mock.calls[0][0].data.passwordHash;
      expect(stored).not.toBe(registerDto.password);
      expect(stored).toMatch(/^\$2[aby]\$/);
      await expect(bcrypt.compare(registerDto.password, stored)).resolves.toBe(
        true,
      );
    });

    it('rejects a duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.register(registerDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects a duplicate organization slug', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.register(registerDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    it('issues a token carrying the user organization', async () => {
      const passwordHash = await bcrypt.hash('CorrectHorseBattery1', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'dana@northwind-labs.test',
        fullName: 'Dana Whitfield',
        role: Role.RECRUITER,
        organizationId: 'org-1',
        passwordHash,
      });

      const result = await service.login({
        email: 'dana@northwind-labs.test',
        password: 'CorrectHorseBattery1',
      });

      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.sub).toBe('user-1');
      expect(decoded.org).toBe('org-1');
      expect(decoded.role).toBe(Role.RECRUITER);
    });

    it('never returns the password hash to the caller', async () => {
      const passwordHash = await bcrypt.hash('CorrectHorseBattery1', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'dana@northwind-labs.test',
        fullName: 'Dana Whitfield',
        role: Role.RECRUITER,
        organizationId: 'org-1',
        passwordHash,
      });

      const result = await service.login({
        email: 'dana@northwind-labs.test',
        password: 'CorrectHorseBattery1',
      });

      expect(JSON.stringify(result)).not.toContain(passwordHash);
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'dana@northwind-labs.test',
        fullName: 'Dana Whitfield',
        role: Role.RECRUITER,
        organizationId: 'org-1',
        passwordHash: await bcrypt.hash('CorrectHorseBattery1', 4),
      });

      await expect(
        service.login({ email: 'dana@northwind-labs.test', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('gives the same error for an unknown account as for a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.test', password: 'whatever' }),
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('inviteUser', () => {
    it('places the new user in the caller organization, not one from input', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-2',
        email: 'new@northwind-labs.test',
        fullName: 'Marcus Adeyemi',
        role: Role.RECRUITER,
        organizationId: 'org-caller',
      });

      await service.inviteUser('org-caller', {
        fullName: 'Marcus Adeyemi',
        email: 'new@northwind-labs.test',
        password: 'AnotherLongPassword1',
        role: Role.RECRUITER,
      });

      expect(prisma.user.create.mock.calls[0][0].data.organizationId).toBe(
        'org-caller',
      );
    });
  });

  describe('currentUser', () => {
    it('re-reads the user scoped by the token organization', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'dana@northwind-labs.test',
        fullName: 'Dana Whitfield',
        role: Role.OWNER,
        organizationId: 'org-1',
        organization: { id: 'org-1', name: 'Northwind', slug: 'northwind' },
      });

      await service.currentUser({
        id: 'user-1',
        email: 'dana@northwind-labs.test',
        role: Role.OWNER,
        organizationId: 'org-1',
      });

      expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({
        id: 'user-1',
        organizationId: 'org-1',
      });
    });

    it('rejects a token whose user no longer exists', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.currentUser({
          id: 'ghost',
          email: 'ghost@example.test',
          role: Role.OWNER,
          organizationId: 'org-1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
