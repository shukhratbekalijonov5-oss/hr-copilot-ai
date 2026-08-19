import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { MembershipService } from '../common/membership/membership.service';
import { Locale, Role } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

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
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
    },
    organization: { findUnique: jest.fn(), create: jest.fn() },
    organizationMember: { findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
}

const actor = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'user-1',
  email: 'dana@northwind-labs.test',
  organizationId: null,
  role: null,
  activeOrganizationClaim: null,
  ...overrides,
});

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
      new MembershipService(prisma as unknown as PrismaService),
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

  /** Transaction stub for the recruiter registration path. */
  function mockRegisterTransaction() {
    const createUser = jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'dana@northwind-labs.test',
      fullName: 'Dana Whitfield',
      preferredLocale: Locale.en,
    });
    const createOrg = jest.fn().mockResolvedValue({ id: 'org-1' });
    const createMembership = jest.fn().mockResolvedValue({
      id: 'm-1',
      userId: 'user-1',
      organizationId: 'org-1',
      role: Role.OWNER,
    });
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: createUser },
        organization: { create: createOrg },
        organizationMember: { create: createMembership },
      }),
    );
    return { createUser, createOrg, createMembership };
  }

  describe('register (hiring intent)', () => {
    it('creates user, organization and OWNER membership; token carries org but no role', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      const { createMembership } = mockRegisterTransaction();

      const result = await service.register(registerDto);

      expect(createMembership.mock.calls[0][0].data.role).toBe(Role.OWNER);
      expect(result.user.role).toBe(Role.OWNER);
      expect(result.user.organizationId).toBe('org-1');

      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.sub).toBe('user-1');
      expect(decoded.org).toBe('org-1');
      // Roles are organization-scoped and resolved live; never a token claim.
      expect(decoded.role).toBeUndefined();
    });

    it('normalises the email to lowercase before storing it', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      const { createUser } = mockRegisterTransaction();

      await service.register(registerDto);

      expect(createUser.mock.calls[0][0].data.email).toBe(
        'dana@northwind-labs.test',
      );
    });

    it('stores a bcrypt hash, never the plaintext password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      const { createUser } = mockRegisterTransaction();

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

    it('rejects organizationName without organizationSlug (and vice versa)', async () => {
      await expect(
        service.register({ ...registerDto, organizationSlug: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.register({ ...registerDto, organizationName: undefined }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('register (job-seeker intent)', () => {
    it('creates a bare user with no organization and no role', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-9',
        email: 'jasur@example.test',
        fullName: 'Jasur Toshmatov',
        preferredLocale: Locale.uz,
      });

      const result = await service.register({
        fullName: 'Jasur Toshmatov',
        email: 'jasur@example.test',
        password: 'CorrectHorseBattery1',
        preferredLocale: Locale.uz,
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.user.role).toBeNull();
      expect(result.user.organizationId).toBeNull();
      expect(result.user.preferredLocale).toBe(Locale.uz);

      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.org).toBeUndefined();
    });
  });

  describe('login', () => {
    const storedUser = async (
      memberships: { organizationId: string; role: Role; createdAt: Date }[],
    ) => ({
      id: 'user-1',
      email: 'dana@northwind-labs.test',
      fullName: 'Dana Whitfield',
      preferredLocale: Locale.en,
      passwordHash: await bcrypt.hash('CorrectHorseBattery1', 4),
      memberships,
    });

    it('activates the oldest membership and signs its org into the token', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await storedUser([
          {
            organizationId: 'org-first',
            role: Role.RECRUITER,
            createdAt: new Date('2026-01-01'),
          },
        ]),
      );

      const result = await service.login({
        email: 'dana@northwind-labs.test',
        password: 'CorrectHorseBattery1',
      });

      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.sub).toBe('user-1');
      expect(decoded.org).toBe('org-first');
      expect(decoded.role).toBeUndefined();
      expect(result.user.role).toBe(Role.RECRUITER);
      expect(result.user.organizationId).toBe('org-first');
    });

    it('logs a membership-less user in with no organization context', async () => {
      prisma.user.findUnique.mockResolvedValue(await storedUser([]));

      const result = await service.login({
        email: 'dana@northwind-labs.test',
        password: 'CorrectHorseBattery1',
      });

      expect(result.user.role).toBeNull();
      expect(result.user.organizationId).toBeNull();
    });

    it('never returns the password hash to the caller', async () => {
      const user = await storedUser([]);
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.login({
        email: 'dana@northwind-labs.test',
        password: 'CorrectHorseBattery1',
      });

      expect(JSON.stringify(result)).not.toContain(user.passwordHash);
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(await storedUser([]));

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

  describe('switchOrganization', () => {
    it('issues a token pointing at the requested org when a membership exists', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm-2',
        userId: 'user-1',
        organizationId: 'org-2',
        role: Role.INTERVIEWER,
        organization: { id: 'org-2', name: 'Acme', slug: 'acme' },
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'dana@northwind-labs.test',
        fullName: 'Dana Whitfield',
        preferredLocale: Locale.en,
      });

      const result = await service.switchOrganization(actor(), 'org-2');

      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.org).toBe('org-2');
      expect(result.user.role).toBe(Role.INTERVIEWER);
      expect(result.activeOrganization).toEqual({
        id: 'org-2',
        name: 'Acme',
        slug: 'acme',
        role: Role.INTERVIEWER,
      });
    });

    it('returns 404 for an organization the caller is not a member of', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(
        service.switchOrganization(actor(), 'org-foreign'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('inviteUser', () => {
    it('creates account + membership in the CALLER organization for a new email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const createUser = jest.fn().mockResolvedValue({
        id: 'user-2',
        email: 'new@northwind-labs.test',
        fullName: 'Marcus Adeyemi',
      });
      const createMembership = jest.fn().mockResolvedValue({
        id: 'm-9',
        organizationId: 'org-caller',
        role: Role.RECRUITER,
      });
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn({
          user: { create: createUser },
          organizationMember: { create: createMembership },
        }),
      );

      const result = await service.inviteUser('org-caller', {
        fullName: 'Marcus Adeyemi',
        email: 'new@northwind-labs.test',
        password: 'AnotherLongPassword1',
        role: Role.RECRUITER,
      });

      expect(createMembership.mock.calls[0][0].data.organizationId).toBe(
        'org-caller',
      );
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('adds a membership (not a new account) for an existing email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-7',
        email: 'existing@example.test',
        fullName: 'Existing Person',
      });
      prisma.organizationMember.findUnique.mockResolvedValue(null);
      prisma.organizationMember.create.mockResolvedValue({
        id: 'm-10',
        organizationId: 'org-caller',
        role: Role.INTERVIEWER,
      });

      const result = await service.inviteUser('org-caller', {
        fullName: 'Ignored Name',
        email: 'existing@example.test',
        password: 'IgnoredPassword123',
        role: Role.INTERVIEWER,
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result.role).toBe(Role.INTERVIEWER);
    });

    it('rejects inviting someone who is already a member', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-7' });
      prisma.organizationMember.findUnique.mockResolvedValue({ id: 'm-11' });

      await expect(
        service.inviteUser('org-caller', {
          fullName: 'Any',
          email: 'existing@example.test',
          password: 'AnotherLongPassword1',
          role: Role.RECRUITER,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('currentUser', () => {
    const dbUser = {
      id: 'user-1',
      email: 'dana@northwind-labs.test',
      fullName: 'Dana Whitfield',
      preferredLocale: Locale.ko,
      candidateAccount: { id: 'acct-1' },
      memberships: [
        {
          organizationId: 'org-1',
          role: Role.RECRUITER,
          createdAt: new Date('2026-01-01'),
          organization: { id: 'org-1', name: 'Northwind', slug: 'northwind' },
        },
        {
          organizationId: 'org-2',
          role: Role.INTERVIEWER,
          createdAt: new Date('2026-02-01'),
          organization: { id: 'org-2', name: 'Acme', slug: 'acme' },
        },
      ],
    };

    it('returns memberships, candidate flag and the CLAIMED active organization', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.currentUser(
        actor({ activeOrganizationClaim: 'org-2' }),
      );

      expect(result.candidateAccount).toEqual({ exists: true });
      expect(result.memberships).toHaveLength(2);
      expect(result.activeOrganization).toEqual({
        id: 'org-2',
        name: 'Acme',
        slug: 'acme',
        role: Role.INTERVIEWER,
      });
      // Legacy-flat compatibility fields mirror the ACTIVE membership.
      expect(result.role).toBe(Role.INTERVIEWER);
      expect(result.organizationId).toBe('org-2');
      expect(result.preferredLocale).toBe(Locale.ko);
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('treats a stale org claim (revoked membership) as no active organization', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.currentUser(
        actor({ activeOrganizationClaim: 'org-revoked' }),
      );

      expect(result.activeOrganization).toBeNull();
      expect(result.role).toBeNull();
      expect(result.organizationId).toBeNull();
    });

    it('rejects a token whose user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.currentUser(actor({ id: 'ghost' })),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
