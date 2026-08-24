import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { CandidateEntitlementsService } from '../entitlements/candidate-entitlements.service';
import { DbPlanSource } from '../entitlements/db-plan.source';
import { AuthSessionService } from './auth-session.service';
import { LoginAttemptsService } from './login-attempts.service';
import { MembershipService } from '../common/membership/membership.service';
import { AccountTypeService } from '../common/identity/account-type.service';
import { AccountType, Locale, Role } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
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
    candidateAccount: {
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ plan: 'FREE' }),
    },
    $transaction: jest.fn(),
  };
}

/** Only /auth/me touches storage, and only to sign the caller's avatar. */
function createStorageMock() {
  return {
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/avatar'),
  } as unknown as StorageService;
}

function createSessionsMock() {
  return {
    createSession: jest.fn().mockResolvedValue({
      session: { id: 'sess-1' },
      refreshToken: 'sess-1.raw-refresh-secret',
    }),
    rotate: jest.fn(),
    revoke: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(2),
    revokeOwned: jest.fn().mockResolvedValue(undefined),
    listForUser: jest.fn().mockResolvedValue([]),
    setActiveOrganization: jest.fn().mockResolvedValue(undefined),
  };
}

const actor = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'user-1',
  email: 'dana@northwind-labs.test',
  accountType: null,
  organizationId: null,
  role: null,
  activeOrganizationClaim: null,
  sessionId: 'sess-1',
  ...overrides,
});

const createLoginAttemptsMock = () => ({
  checkBeforeAttempt: jest
    .fn()
    .mockResolvedValue({ locked: false, retryAfterSeconds: 0 }),
  recordFailure: jest.fn().mockResolvedValue(undefined),
  recordSuccess: jest.fn().mockResolvedValue(undefined),
});

describe('AuthService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let sessions: ReturnType<typeof createSessionsMock>;
  let loginAttempts: ReturnType<typeof createLoginAttemptsMock>;
  let jwtService: JwtService;
  let service: AuthService;

  beforeEach(() => {
    prisma = createPrismaMock();
    sessions = createSessionsMock();
    loginAttempts = createLoginAttemptsMock();
    jwtService = new JwtService({
      secret: CONFIG['auth.secretToken'] as string,
    });
    service = new AuthService(
      prisma as unknown as PrismaService,
      new MembershipService(prisma as unknown as PrismaService),
      new AccountTypeService(prisma as unknown as PrismaService),
      sessions as unknown as AuthSessionService,
      loginAttempts as unknown as LoginAttemptsService,
      jwtService,
      createConfigMock(),
      createStorageMock(),
      new CandidateEntitlementsService(
        new DbPlanSource(prisma as unknown as PrismaService),
      ),
    );
  });

  const registerOrgDto = {
    organizationName: 'Northwind Labs',
    organizationSlug: 'northwind-labs',
    fullName: 'Dana Whitfield',
    email: 'Dana@Northwind-Labs.test',
    password: 'CorrectHorseBattery1',
  };

  /** Transaction stub for the organization registration path. */
  function mockOrgRegisterTransaction() {
    const createUser = jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'dana@northwind-labs.test',
      fullName: 'Dana Whitfield',
      accountType: AccountType.ORGANIZATION,
      preferredLocale: Locale.en,
    });
    const createOrg = jest.fn().mockResolvedValue({ id: 'org-1' });
    const createMembership = jest.fn().mockResolvedValue({
      id: 'm-1',
      userId: 'user-1',
      organizationId: 'org-1',
      role: Role.OWNER,
    });
    const createCandidateAccount = jest.fn();
    const createOutboxEvent = jest.fn();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: createUser },
        organization: { create: createOrg },
        organizationMember: { create: createMembership },
        candidateAccount: { create: createCandidateAccount },
        notificationOutboxEvent: { create: createOutboxEvent },
      }),
    );
    return {
      createUser,
      createOrg,
      createMembership,
      createCandidateAccount,
      createOutboxEvent,
    };
  }

  /** Transaction stub for the candidate registration path. */
  function mockCandidateRegisterTransaction() {
    const createUser = jest.fn().mockResolvedValue({
      id: 'user-9',
      email: 'jasur@example.test',
      fullName: 'Jasur Toshmatov',
      accountType: AccountType.CANDIDATE,
      preferredLocale: Locale.uz,
    });
    const createCandidateAccount = jest
      .fn()
      .mockResolvedValue({ id: 'acct-1', userId: 'user-9' });
    const createOrg = jest.fn();
    const createMembership = jest.fn();
    const createOutboxEvent = jest.fn();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: createUser },
        organization: { create: createOrg },
        organizationMember: { create: createMembership },
        candidateAccount: { create: createCandidateAccount },
        notificationOutboxEvent: { create: createOutboxEvent },
      }),
    );
    return {
      createUser,
      createOrg,
      createMembership,
      createCandidateAccount,
      createOutboxEvent,
    };
  }

  describe('registerOrganization', () => {
    it('creates user, organization and OWNER membership; token carries org but no role or type', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      const { createUser, createMembership, createCandidateAccount } =
        mockOrgRegisterTransaction();

      const result = await service.registerOrganization(registerOrgDto);

      expect(createUser.mock.calls[0][0].data.accountType).toBe(
        AccountType.ORGANIZATION,
      );
      expect(createMembership.mock.calls[0][0].data.role).toBe(Role.OWNER);
      // The other identity is NEVER created here.
      expect(createCandidateAccount).not.toHaveBeenCalled();
      expect(result.user.role).toBe(Role.OWNER);
      expect(result.user.organizationId).toBe('org-1');
      expect(result.user.accountType).toBe(AccountType.ORGANIZATION);

      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.sub).toBe('user-1');
      expect(decoded.org).toBe('org-1');
      expect(decoded.sid).toBe('sess-1');
      // Roles are organization-scoped and resolved live; never a token claim.
      expect(decoded.role).toBeUndefined();
      // Account type is re-derived from the database per request, not cached
      // in the token.
      expect(decoded.accountType).toBeUndefined();
    });

    it('opens a refresh session and returns its raw token once', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      mockOrgRegisterTransaction();

      const result = await service.registerOrganization(registerOrgDto);

      expect(sessions.createSession).toHaveBeenCalledWith('user-1', {
        activeOrganizationId: 'org-1',
        userAgent: null,
        deviceName: null,
      });
      expect(result.refreshToken).toBe('sess-1.raw-refresh-secret');
    });

    it('normalises the email to lowercase before storing it', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      const { createUser } = mockOrgRegisterTransaction();

      await service.registerOrganization(registerOrgDto);

      expect(createUser.mock.calls[0][0].data.email).toBe(
        'dana@northwind-labs.test',
      );
    });

    it('stores a bcrypt hash, never the plaintext password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);
      const { createUser } = mockOrgRegisterTransaction();

      await service.registerOrganization(registerOrgDto);

      const stored = createUser.mock.calls[0][0].data.passwordHash;
      expect(stored).not.toBe(registerOrgDto.password);
      expect(stored).toMatch(/^\$2[aby]\$/);
      await expect(
        bcrypt.compare(registerOrgDto.password, stored),
      ).resolves.toBe(true);
    });

    it('rejects an email already registered as an ORGANIZATION account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        accountType: AccountType.ORGANIZATION,
      });
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.registerOrganization(registerOrgDto),
      ).rejects.toThrow(
        expect.objectContaining({
          constructor: ConflictException,
          response: expect.objectContaining({
            code: 'AUTH_EMAIL_ALREADY_REGISTERED',
          }),
        }),
      );
    });

    it('rejects an email that belongs to a CANDIDATE account (cross-type)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        accountType: AccountType.CANDIDATE,
      });
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.registerOrganization(registerOrgDto),
      ).rejects.toThrow(
        expect.objectContaining({
          constructor: ConflictException,
          response: expect.objectContaining({
            code: 'AUTH_ACCOUNT_TYPE_CONFLICT',
          }),
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a duplicate organization slug', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.registerOrganization(registerOrgDto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('registerCandidate', () => {
    const registerCandidateDto = {
      fullName: 'Jasur Toshmatov',
      email: 'Jasur@Example.test',
      password: 'CorrectHorseBattery1',
      preferredLocale: Locale.uz,
    };

    it('creates the user AND their candidate account in one transaction — nothing else', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const {
        createUser,
        createOrg,
        createMembership,
        createCandidateAccount,
      } = mockCandidateRegisterTransaction();

      const result = await service.registerCandidate(registerCandidateDto);

      expect(createUser.mock.calls[0][0].data).toMatchObject({
        email: 'jasur@example.test',
        accountType: AccountType.CANDIDATE,
        preferredLocale: Locale.uz,
      });
      expect(createCandidateAccount).toHaveBeenCalledWith({
        data: { userId: 'user-9' },
      });
      // No organization, no membership — ever.
      expect(createOrg).not.toHaveBeenCalled();
      expect(createMembership).not.toHaveBeenCalled();

      expect(result.user.accountType).toBe(AccountType.CANDIDATE);
      expect(result.user.role).toBeNull();
      expect(result.user.organizationId).toBeNull();
      expect(result.user.preferredLocale).toBe(Locale.uz);
      expect(result.refreshToken).toBe('sess-1.raw-refresh-secret');

      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.org).toBeUndefined();
      expect(decoded.accountType).toBeUndefined();
    });

    it('opens the session with no organization context', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      mockCandidateRegisterTransaction();

      await service.registerCandidate(registerCandidateDto);

      expect(sessions.createSession).toHaveBeenCalledWith('user-9', {
        activeOrganizationId: null,
        userAgent: null,
        deviceName: null,
      });
    });

    it('rejects an email already registered as a CANDIDATE account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        accountType: AccountType.CANDIDATE,
      });

      await expect(
        service.registerCandidate(registerCandidateDto),
      ).rejects.toThrow(
        expect.objectContaining({
          constructor: ConflictException,
          response: expect.objectContaining({
            code: 'AUTH_EMAIL_ALREADY_REGISTERED',
          }),
        }),
      );
    });

    it('rejects an email that belongs to an ORGANIZATION account (cross-type)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        accountType: AccountType.ORGANIZATION,
      });

      await expect(
        service.registerCandidate(registerCandidateDto),
      ).rejects.toThrow(
        expect.objectContaining({
          constructor: ConflictException,
          response: expect.objectContaining({
            code: 'AUTH_ACCOUNT_TYPE_CONFLICT',
          }),
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const storedUser = async (
      memberships: { organizationId: string; role: Role; createdAt: Date }[],
      accountType: AccountType = AccountType.ORGANIZATION,
    ) => ({
      id: 'user-1',
      email: 'dana@northwind-labs.test',
      fullName: 'Dana Whitfield',
      accountType,
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
      expect(result.user.accountType).toBe(AccountType.ORGANIZATION);
    });

    it('logs a candidate in with no organization context', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await storedUser([], AccountType.CANDIDATE),
      );

      const result = await service.login({
        email: 'dana@northwind-labs.test',
        password: 'CorrectHorseBattery1',
      });

      expect(result.user.role).toBeNull();
      expect(result.user.organizationId).toBeNull();
      expect(result.user.accountType).toBe(AccountType.CANDIDATE);
      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.org).toBeUndefined();
    });

    it('accepts a matching explicit accountType (right door)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await storedUser([], AccountType.CANDIDATE),
      );

      await expect(
        service.login({
          email: 'dana@northwind-labs.test',
          password: 'CorrectHorseBattery1',
          accountType: AccountType.CANDIDATE,
        }),
      ).resolves.toMatchObject({
        user: { accountType: AccountType.CANDIDATE },
      });
    });

    it('rejects a CANDIDATE signing in through the organization door', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await storedUser([], AccountType.CANDIDATE),
      );

      await expect(
        service.login({
          email: 'dana@northwind-labs.test',
          password: 'CorrectHorseBattery1',
          accountType: AccountType.ORGANIZATION,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          constructor: ForbiddenException,
          response: expect.objectContaining({
            code: 'AUTH_ACCOUNT_TYPE_MISMATCH',
          }),
        }),
      );
      expect(sessions.createSession).not.toHaveBeenCalled();
    });

    it('rejects an ORGANIZATION account signing in through the candidate door', async () => {
      prisma.user.findUnique.mockResolvedValue(
        await storedUser([
          {
            organizationId: 'org-1',
            role: Role.OWNER,
            createdAt: new Date('2026-01-01'),
          },
        ]),
      );

      await expect(
        service.login({
          email: 'dana@northwind-labs.test',
          password: 'CorrectHorseBattery1',
          accountType: AccountType.CANDIDATE,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          constructor: ForbiddenException,
          response: expect.objectContaining({
            code: 'AUTH_ACCOUNT_TYPE_MISMATCH',
          }),
        }),
      );
    });

    it('keeps the flat 401 for a WRONG password even with a mismatched accountType', async () => {
      // The wrong-door distinction must never leak to a caller who has not
      // proven the password: bad credentials stay "Invalid credentials".
      prisma.user.findUnique.mockResolvedValue(
        await storedUser([], AccountType.CANDIDATE),
      );

      await expect(
        service.login({
          email: 'dana@northwind-labs.test',
          password: 'wrong',
          accountType: AccountType.ORGANIZATION,
        }),
      ).rejects.toThrow('Invalid credentials');
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

    describe('lockout wiring', () => {
      it('a locked identity gets 429 + retryAfterSeconds BEFORE any lookup or hash work', async () => {
        loginAttempts.checkBeforeAttempt.mockResolvedValue({
          locked: true,
          retryAfterSeconds: 842,
        });

        await expect(
          service.login(
            { email: 'Dana@Northwind-Labs.test', password: 'whatever' },
            { ip: '203.0.113.7' },
          ),
        ).rejects.toMatchObject({
          response: {
            statusCode: 429,
            code: 'LOGIN_TEMPORARILY_LOCKED',
            retryAfterSeconds: 842,
          },
        });
        // No expensive work happened behind the lock.
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        // The identity was normalized before scoping.
        expect(loginAttempts.checkBeforeAttempt).toHaveBeenCalledWith(
          'dana@northwind-labs.test',
          '203.0.113.7',
        );
      });

      it('a wrong password records a failure with the normalized identity and IP', async () => {
        prisma.user.findUnique.mockResolvedValue(await storedUser([]));

        await expect(
          service.login(
            { email: 'dana@northwind-labs.test', password: 'wrong' },
            { ip: '203.0.113.7' },
          ),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(loginAttempts.recordFailure).toHaveBeenCalledWith(
          'dana@northwind-labs.test',
          '203.0.113.7',
        );
        expect(loginAttempts.recordSuccess).not.toHaveBeenCalled();
      });

      it('an unknown email records a failure exactly like a wrong password (no oracle)', async () => {
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(
          service.login(
            { email: 'nobody@example.test', password: 'whatever' },
            { ip: '203.0.113.7' },
          ),
        ).rejects.toThrow('Invalid credentials');
        expect(loginAttempts.recordFailure).toHaveBeenCalledWith(
          'nobody@example.test',
          '203.0.113.7',
        );
      });

      it('a successful login resets the failure state', async () => {
        prisma.user.findUnique.mockResolvedValue(await storedUser([]));

        await service.login(
          {
            email: 'dana@northwind-labs.test',
            password: 'CorrectHorseBattery1',
          },
          { ip: '203.0.113.7' },
        );
        expect(loginAttempts.recordSuccess).toHaveBeenCalledWith(
          'dana@northwind-labs.test',
          '203.0.113.7',
        );
        expect(loginAttempts.recordFailure).not.toHaveBeenCalled();
      });

      it('a wrong-door login (verified password) still counts as success, not failure', async () => {
        prisma.user.findUnique.mockResolvedValue(
          await storedUser([], AccountType.ORGANIZATION),
        );

        await expect(
          service.login(
            {
              email: 'dana@northwind-labs.test',
              password: 'CorrectHorseBattery1',
              accountType: AccountType.CANDIDATE,
            },
            { ip: '203.0.113.7' },
          ),
        ).rejects.toMatchObject({
          response: { code: 'AUTH_ACCOUNT_TYPE_MISMATCH' },
        });
        expect(loginAttempts.recordSuccess).toHaveBeenCalled();
        expect(loginAttempts.recordFailure).not.toHaveBeenCalled();
      });
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
        accountType: AccountType.ORGANIZATION,
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
    it('creates an ORGANIZATION account + membership in the CALLER organization for a new email', async () => {
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

      expect(createUser.mock.calls[0][0].data.accountType).toBe(
        AccountType.ORGANIZATION,
      );
      expect(createMembership.mock.calls[0][0].data.organizationId).toBe(
        'org-caller',
      );
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('adds a membership (not a new account) for an existing ORGANIZATION email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-7',
        email: 'existing@example.test',
        fullName: 'Existing Person',
        accountType: AccountType.ORGANIZATION,
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

    it('refuses to invite a CANDIDATE email — no silent conversion, no dual identity', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-8',
        email: 'seeker@example.test',
        fullName: 'Jasur Toshmatov',
        accountType: AccountType.CANDIDATE,
      });

      await expect(
        service.inviteUser('org-caller', {
          fullName: 'Any',
          email: 'seeker@example.test',
          password: 'AnotherLongPassword1',
          role: Role.RECRUITER,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          constructor: ConflictException,
          response: expect.objectContaining({
            code: 'AUTH_ACCOUNT_TYPE_CONFLICT',
          }),
        }),
      );
      expect(prisma.organizationMember.create).not.toHaveBeenCalled();
      expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
    });

    it('rejects inviting someone who is already a member', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-7',
        accountType: AccountType.ORGANIZATION,
      });
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
    const orgDbUser = {
      id: 'user-1',
      email: 'dana@northwind-labs.test',
      fullName: 'Dana Whitfield',
      accountType: AccountType.ORGANIZATION,
      preferredLocale: Locale.ko,
      candidateAccount: null,
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

    const candidateDbUser = {
      id: 'user-9',
      email: 'jasur@example.test',
      fullName: 'Jasur Toshmatov',
      accountType: AccountType.CANDIDATE,
      preferredLocale: Locale.uz,
      candidateAccount: { id: 'acct-1' },
      memberships: [],
    };

    it('returns account type, memberships and the CLAIMED active organization', async () => {
      prisma.user.findUnique.mockResolvedValue(orgDbUser);

      const result = await service.currentUser(
        actor({ activeOrganizationClaim: 'org-2' }),
      );

      expect(result.accountType).toBe(AccountType.ORGANIZATION);
      expect(result.user.accountType).toBe(AccountType.ORGANIZATION);
      expect(result.candidateAccount).toEqual({ exists: false });
      // No plan and no capabilities on an org identity — the plan model is
      // candidate-only and the recruiter response shape is unchanged.
      expect(result.candidateAccount).not.toHaveProperty('plan');
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

    it('returns the candidate shape for a CANDIDATE account', async () => {
      prisma.user.findUnique.mockResolvedValue(candidateDbUser);

      const result = await service.currentUser(actor({ id: 'user-9' }));

      expect(result.accountType).toBe(AccountType.CANDIDATE);
      // The read contract (Task 4C.5.1 follow-up): plan + everything it
      // grants, resolved through the entitlement seam. FREE grants nothing.
      expect(result.candidateAccount).toEqual({
        exists: true,
        plan: 'FREE',
        capabilities: [],
      });
      expect(result.memberships).toHaveLength(0);
      expect(result.activeOrganization).toBeNull();
      expect(result.role).toBeNull();
      expect(result.organizationId).toBeNull();
    });

    it.each([
      ['FREE', []],
      ['PRO', ['INTERNAL_AI_SEARCH']],
      ['MAX', ['INTERNAL_AI_SEARCH', 'EXTERNAL_AI_SEARCH']],
    ])(
      'publishes the %s plan with exactly what it grants',
      async (plan, granted) => {
        prisma.user.findUnique.mockResolvedValue(candidateDbUser);
        prisma.candidateAccount.findUnique.mockResolvedValue({ plan });

        const result = await service.currentUser(actor({ id: 'user-9' }));

        expect(result.candidateAccount).toEqual({
          exists: true,
          plan,
          capabilities: granted,
        });
      },
    );

    it('publishes an unknown plan value fail-closed — zero capabilities', async () => {
      // A future tier read by this deploy: the plan echoes as stored, but
      // grants NOTHING until the policy table knows it.
      prisma.user.findUnique.mockResolvedValue(candidateDbUser);
      prisma.candidateAccount.findUnique.mockResolvedValue({
        plan: 'ENTERPRISE',
      });

      const result = await service.currentUser(actor({ id: 'user-9' }));
      expect(result.candidateAccount).toMatchObject({ capabilities: [] });
    });

    it('treats a stale org claim (revoked membership) as no active organization', async () => {
      prisma.user.findUnique.mockResolvedValue(orgDbUser);

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

  describe('refresh', () => {
    const rotated = (activeOrganizationId: string | null) => ({
      session: { id: 'sess-1', userId: 'user-1', activeOrganizationId },
      refreshToken: 'sess-1.NEW-secret',
    });
    const dbUser = {
      id: 'user-1',
      email: 'dana@northwind-labs.test',
      fullName: 'Dana Whitfield',
      accountType: AccountType.ORGANIZATION,
      preferredLocale: Locale.en,
    };

    it('returns a new access token and the ROTATED refresh token', async () => {
      sessions.rotate.mockResolvedValue(rotated('org-1'));
      prisma.user.findUnique.mockResolvedValue(dbUser);
      prisma.organizationMember.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        role: Role.RECRUITER,
      });

      const result = await service.refresh('sess-1.OLD-secret');

      expect(result.refreshToken).toBe('sess-1.NEW-secret');
      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.sub).toBe('user-1');
      expect(decoded.sid).toBe('sess-1');
      // The session's persisted workspace context survives the refresh…
      expect(decoded.org).toBe('org-1');
      // …but the role is looked up live, never signed into the token.
      expect(decoded.role).toBeUndefined();
      expect(result.user.role).toBe(Role.RECRUITER);
    });

    it('degrades to an organization-less token when the membership was revoked', async () => {
      sessions.rotate.mockResolvedValue(rotated('org-gone'));
      prisma.user.findUnique.mockResolvedValue(dbUser);
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      const result = await service.refresh('sess-1.OLD-secret');

      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.org).toBeUndefined();
      expect(result.user.role).toBeNull();
      expect(sessions.setActiveOrganization).toHaveBeenCalledWith(
        'sess-1',
        null,
      );
    });

    it('revokes the session and rejects when the user was deleted', async () => {
      sessions.rotate.mockResolvedValue(rotated(null));
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.refresh('sess-1.OLD-secret')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(sessions.revoke).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('logout / logout-all / session management', () => {
    it('logout revokes exactly the CURRENT session', async () => {
      await expect(service.logout(actor())).resolves.toEqual({
        loggedOut: true,
      });
      expect(sessions.revoke).toHaveBeenCalledWith('sess-1');
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('logout without a session claim is a harmless no-op', async () => {
      await expect(service.logout(actor({ sessionId: null }))).resolves.toEqual(
        { loggedOut: true },
      );
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('logout-all revokes every live session of the user', async () => {
      await expect(service.logoutAll(actor())).resolves.toEqual({
        loggedOut: true,
        revokedSessions: 2,
      });
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('session listing and revocation are scoped to the CALLER', async () => {
      await service.listSessions(actor());
      expect(sessions.listForUser).toHaveBeenCalledWith('user-1', 'sess-1');

      await service.revokeSession(actor(), 'sess-2');
      expect(sessions.revokeOwned).toHaveBeenCalledWith('user-1', 'sess-2');
    });
  });

  describe('switchOrganization × sessions', () => {
    it('persists the choice on the session WITHOUT rotating the refresh token', async () => {
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
        accountType: AccountType.ORGANIZATION,
        preferredLocale: Locale.en,
      });

      const result = await service.switchOrganization(actor(), 'org-2');

      expect(sessions.setActiveOrganization).toHaveBeenCalledWith(
        'sess-1',
        'org-2',
      );
      expect(sessions.rotate).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('refreshToken');
      const decoded = jwtService.verify(result.accessToken, {
        secret: CONFIG['auth.secretToken'] as string,
      });
      expect(decoded.org).toBe('org-2');
      expect(decoded.sid).toBe('sess-1');
    });
  });
});
