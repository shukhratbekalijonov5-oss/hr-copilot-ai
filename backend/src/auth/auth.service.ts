import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../common/membership/membership.service';
import { AccountTypeService } from '../common/identity/account-type.service';
import { AuthSessionService } from './auth-session.service';
import { StorageService } from '../storage/storage.service';
import { signAvatarUrl } from '../account/avatar-url';
import {
  AUTH_ERROR_CODES,
  authConflict,
  authForbidden,
  authUnauthorized,
} from './auth-errors';
import { AccountType, Locale, Role } from '../generated/prisma/enums';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../common/interfaces/authenticated-user.interface';
import type { RegisterCandidateDto } from './dto/register-candidate.dto';
import type { RegisterOrganizationDto } from './dto/register-organization.dto';
import type { LoginDto } from './dto/login.dto';
import { CandidateEntitlementsService } from '../entitlements/candidate-entitlements.service';
import type { InviteUserDto } from './dto/invite-user.dto';

/**
 * `role`/`organizationId` describe the ACTIVE organization membership — always
 * null for CANDIDATE accounts, which can never hold one. They are kept at this
 * level for frontend compatibility with the pre-migration single-org shape.
 */
export interface AuthTokenResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    accountType: AccountType;
    preferredLocale: Locale;
    role: Role | null;
    organizationId: string | null;
  };
}

/** Login/register/refresh: a session credential travels with the tokens. */
export interface AuthSessionResponse extends AuthTokenResponse {
  refreshToken: string;
}

interface ActiveMembership {
  organizationId: string;
  role: Role;
}

/** Transport-neutral request context captured at session creation. */
export interface SessionContext {
  userAgent?: string | null;
  deviceName?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
    private readonly accountTypes: AccountTypeService,
    private readonly sessions: AuthSessionService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    // StorageModule is @Global, so this needs no module import. Only used to
    // mint the caller's own avatar URL for /auth/me.
    private readonly storage: StorageService,
    // EntitlementsModule is @Global. /auth/me publishes the plan through the
    // SAME seam the guards enforce with — never a second plan read.
    private readonly entitlements: CandidateEntitlementsService,
  ) {}

  /**
   * Creates a CANDIDATE account: the User and their CandidateAccount are one
   * identity, created in one transaction. Never an organization, never a
   * membership — that is the other account type.
   */
  async registerCandidate(
    dto: RegisterCandidateDto,
    context: SessionContext = {},
  ): Promise<AuthSessionResponse> {
    const email = normaliseEmail(dto.email);
    await this.assertEmailAvailable(email, AccountType.CANDIDATE);

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName,
          accountType: AccountType.CANDIDATE,
          preferredLocale: dto.preferredLocale ?? Locale.en,
        },
      });
      await tx.candidateAccount.create({ data: { userId: created.id } });
      return created;
    });

    return this.openSession(user, null, dto.deviceName, context);
  }

  /**
   * Creates an ORGANIZATION account: the User, their Organization and its
   * OWNER membership in one transaction. Never a CandidateAccount — that is
   * the other account type.
   */
  async registerOrganization(
    dto: RegisterOrganizationDto,
    context: SessionContext = {},
  ): Promise<AuthSessionResponse> {
    const email = normaliseEmail(dto.email);
    const [, existingOrg] = await Promise.all([
      this.assertEmailAvailable(email, AccountType.ORGANIZATION),
      this.prisma.organization.findUnique({
        where: { slug: dto.organizationSlug },
      }),
    ]);
    if (existingOrg)
      throw new ConflictException('Organization slug is already taken');

    const passwordHash = await this.hashPassword(dto.password);
    // No orphaned users or organizations on failure: one transaction.
    const { user, membership } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName,
          accountType: AccountType.ORGANIZATION,
          preferredLocale: dto.preferredLocale ?? Locale.en,
        },
      });
      const organization = await tx.organization.create({
        data: { name: dto.organizationName, slug: dto.organizationSlug },
      });
      const member = await tx.organizationMember.create({
        data: {
          userId: created.id,
          organizationId: organization.id,
          role: Role.OWNER,
        },
      });
      return { user: created, membership: member };
    });

    return this.openSession(user, membership, dto.deviceName, context);
  }

  /**
   * Email exclusivity is global and cross-type: one address is at most ONE
   * account, of exactly one type. The distinct codes let the UI route the
   * person to the right sign-in; registration has always disclosed address
   * existence, so the type adds no meaningful new disclosure (see
   * AUTH_ERROR_CODES).
   */
  private async assertEmailAvailable(
    email: string,
    intent: AccountType,
  ): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { accountType: true },
    });
    if (!existing) return;
    if (existing.accountType === intent) {
      throw authConflict(
        AUTH_ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'Email is already registered',
      );
    }
    throw authConflict(
      AUTH_ERROR_CODES.ACCOUNT_TYPE_CONFLICT,
      intent === AccountType.CANDIDATE
        ? 'This email already belongs to an organization account'
        : 'This email already belongs to a candidate account',
    );
  }

  async login(
    dto: LoginDto,
    context: SessionContext = {},
  ): Promise<AuthSessionResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(dto.email) },
      include: {
        // Default active organization: the oldest membership. Deterministic,
        // and a no-membership user simply logs in without organization context.
        memberships: { orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });

    // Compare against a dummy hash when the user is absent so that response
    // timing does not reveal whether the address exists.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const matches = await bcrypt.compare(dto.password, hash);

    if (!user || !matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Wrong sign-in door (Candidate vs Organization). Checked only AFTER the
    // password verified: holders of bad credentials keep getting the flat 401
    // above and learn nothing about the account's existence or type.
    if (dto.accountType && dto.accountType !== user.accountType) {
      throw authForbidden(
        AUTH_ERROR_CODES.ACCOUNT_TYPE_MISMATCH,
        user.accountType === AccountType.CANDIDATE
          ? 'This email belongs to a candidate account — use the candidate sign-in'
          : 'This email belongs to an organization account — use the organization sign-in',
      );
    }

    return this.openSession(
      user,
      user.accountType === AccountType.ORGANIZATION
        ? (user.memberships[0] ?? null)
        : null,
      dto.deviceName,
      context,
    );
  }

  /**
   * Rotates a refresh token: validates the session, replaces the secret and
   * returns a fresh short-lived access token. The new access token's `org`
   * claim comes from the SESSION's persisted context, re-checked against a
   * live membership — a revoked membership silently degrades the session to
   * organization-less instead of failing the refresh: the account itself is
   * still valid (an ORGANIZATION user removed from one org may hold other
   * memberships, or pick one up again later). CANDIDATE sessions never carry
   * an organization context at all.
   */
  async refresh(rawRefreshToken: string): Promise<AuthSessionResponse> {
    const { session, refreshToken } =
      await this.sessions.rotate(rawRefreshToken);

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user) {
      // The account was deleted after the session was issued.
      await this.sessions.revoke(session.id);
      throw authUnauthorized(
        AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    let active: ActiveMembership | null = null;
    if (session.activeOrganizationId) {
      active = await this.memberships.findMembership(
        user.id,
        session.activeOrganizationId,
      );
      if (!active) {
        await this.sessions.setActiveOrganization(session.id, null);
      }
    }

    return {
      ...(await this.buildTokenResponse(user, active, session.id)),
      refreshToken,
    };
  }

  /** Revokes the CURRENT session; other devices stay signed in. Idempotent. */
  async logout(actor: AuthenticatedUser): Promise<{ loggedOut: boolean }> {
    if (actor.sessionId) {
      await this.sessions.revoke(actor.sessionId);
    }
    return { loggedOut: true };
  }

  /** Signs the user out everywhere (lost device / security event). */
  async logoutAll(
    actor: AuthenticatedUser,
  ): Promise<{ loggedOut: boolean; revokedSessions: number }> {
    const revokedSessions = await this.sessions.revokeAllForUser(actor.id);
    return { loggedOut: true, revokedSessions };
  }

  /** The caller's live sessions, the current one flagged. Safe fields only. */
  listSessions(actor: AuthenticatedUser) {
    return this.sessions.listForUser(actor.id, actor.sessionId);
  }

  /** Revokes one of the caller's OWN sessions; foreign/unknown ids are 404. */
  async revokeSession(actor: AuthenticatedUser, sessionId: string) {
    await this.sessions.revokeOwned(actor.id, sessionId);
    return { id: sessionId, revoked: true };
  }

  /**
   * Activates another organization the caller belongs to, by returning a new
   * access token whose `org` claim names it. The claim is only a pointer —
   * every org-scoped request re-verifies the membership row — but it is still
   * only issued against a real membership. A guessed/foreign organization id
   * gets 404 without confirming whether that organization exists.
   *
   * The refresh session is NOT rotated: the session authenticates the
   * user/device, while the active organization is per-device CONTEXT. The
   * choice is persisted on the session so a later refresh keeps minting
   * tokens for the same workspace. Rotating here would add token churn with
   * zero security gain — authorization is re-derived from the live membership
   * on every request regardless of what any token says.
   */
  async switchOrganization(
    actor: AuthenticatedUser,
    organizationId: string,
  ): Promise<AuthTokenResponse & { activeOrganization: unknown }> {
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: { userId: actor.id, organizationId },
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!membership) {
      throw new NotFoundException('Organization not found');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');

    if (actor.sessionId) {
      await this.sessions.setActiveOrganization(
        actor.sessionId,
        organizationId,
      );
    }

    const response = await this.buildTokenResponse(
      user,
      membership,
      actor.sessionId,
    );
    return {
      ...response,
      activeOrganization: {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      },
    };
  }

  /**
   * Adds a member to the *caller's* organization. organizationId comes from
   * the validated membership context, never from the request body.
   *
   * An email that already has an ORGANIZATION account is added as a member of
   * this organization (multi-org is the normal case); their existing password
   * and name are left untouched — the supplied ones are ignored. An email that
   * belongs to a CANDIDATE account is refused with 409
   * AUTH_ACCOUNT_TYPE_CONFLICT: account types are exclusive, and an invitation
   * must never convert one or create a dual identity. A brand-new email gets
   * an ORGANIZATION account and the membership in one transaction.
   */
  async inviteUser(organizationId: string, dto: InviteUserDto) {
    const email = normaliseEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      this.accountTypes.assertCanHoldMembership(existing);
      const membership = await this.memberships.findMembership(
        existing.id,
        organizationId,
      );
      if (membership) {
        throw new ConflictException(
          'User is already a member of this organization',
        );
      }
      const created = await this.prisma.organizationMember.create({
        data: { userId: existing.id, organizationId, role: dto.role },
      });
      return toTeamMember(existing, created);
    }

    const { user, membership } = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email,
          passwordHash: await this.hashPassword(dto.password),
          fullName: dto.fullName,
          accountType: AccountType.ORGANIZATION,
        },
      });
      const member = await tx.organizationMember.create({
        data: { userId: createdUser.id, organizationId, role: dto.role },
      });
      return { user: createdUser, membership: member };
    });
    return toTeamMember(user, membership);
  }

  /**
   * The session contract (see docs/identity-contracts.md).
   *
   * Re-reads everything from the database so a deleted account, a revoked
   * membership or a changed role is reflected immediately. The active
   * organization is the token's org claim IF a membership still backs it —
   * a stale claim yields activeOrganization: null rather than dead access.
   */
  async currentUser(actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      include: {
        candidateAccount: { select: { id: true } },
        memberships: {
          orderBy: { createdAt: 'asc' },
          include: {
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');

    const active =
      user.memberships.find(
        (m) => m.organizationId === actor.activeOrganizationClaim,
      ) ?? null;

    // Short-lived and re-minted on every read, so the header always shows the
    // current picture and no response ever carries the storage key.
    const avatarUrl = await signAvatarUrl(this.storage, user.avatarStorageKey);

    /*
     * The candidate's plan and what it grants, so the UI can label tiers and
     * lock gated surfaces BEFORE a request earns a 403. Resolved through the
     * entitlement seam (today the plan column; later the Java Payment
     * Service) — this response is a mirror of enforcement, never an input to
     * it: the capability guards re-resolve the plan on every gated request
     * and remain the final authority whatever a client renders or claims.
     */
    const entitlements = user.candidateAccount
      ? await this.entitlements.entitlementsFor(user.id)
      : null;

    return {
      // Legacy-flat fields, kept for the pre-migration frontend contract.
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      accountType: user.accountType,
      preferredLocale: user.preferredLocale,
      avatarUrl,
      role: active?.role ?? null,
      organizationId: active?.organizationId ?? null,
      organization: active ? active.organization : null,
      // Canonical shape. `accountType` decides which workspace the account
      // lives in; `candidateAccount.exists`/`memberships` describe the one
      // side that can apply to this account.
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        accountType: user.accountType,
        preferredLocale: user.preferredLocale,
        /// null means "no picture" — the UI renders initials, which is a
        /// normal state and not a missing value.
        avatarUrl,
      },
      candidateAccount: entitlements
        ? {
            exists: true,
            plan: entitlements.plan,
            capabilities: entitlements.capabilities,
          }
        : { exists: false },
      activeOrganization: active
        ? {
            id: active.organization.id,
            name: active.organization.name,
            slug: active.organization.slug,
            role: active.role,
          }
        : null,
      memberships: user.memberships.map((m) => ({
        organization: m.organization,
        role: m.role,
        joinedAt: m.createdAt,
      })),
    };
  }

  private hashPassword(plain: string): Promise<string> {
    const rounds = this.configService.get<number>('auth.bcryptRounds', 12);
    return bcrypt.hash(plain, rounds);
  }

  /** Login/registration tail: persist a session, then mint both tokens. */
  private async openSession(
    user: {
      id: string;
      email: string;
      fullName: string;
      accountType: AccountType;
      preferredLocale: Locale;
    },
    active: ActiveMembership | null,
    deviceName: string | undefined,
    context: SessionContext,
  ): Promise<AuthSessionResponse> {
    const { session, refreshToken } = await this.sessions.createSession(
      user.id,
      {
        activeOrganizationId: active?.organizationId ?? null,
        userAgent: context.userAgent ?? null,
        deviceName: deviceName ?? context.deviceName ?? null,
      },
    );
    return {
      ...(await this.buildTokenResponse(user, active, session.id)),
      refreshToken,
    };
  }

  /**
   * The JWT payload stays `{sub, email, org?, sid?}` — deliberately NO
   * accountType claim. The type is immutable, so caching it would be safe,
   * but both scoped guards already consult the database per request (the
   * live-membership / live-account-type checks), so a claim would add an
   * unverified copy of a fact the server re-derives anyway. The response
   * BODY carries accountType for client-side routing only.
   */
  private async buildTokenResponse(
    user: {
      id: string;
      email: string;
      fullName: string;
      accountType: AccountType;
      preferredLocale: Locale;
    },
    active: ActiveMembership | null,
    sessionId: string | null,
  ): Promise<AuthTokenResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      ...(active ? { org: active.organizationId } : {}),
      ...(sessionId ? { sid: sessionId } : {}),
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('auth.secretToken'),
      // jsonwebtoken types this as `number | ms.StringValue`; the value is a
      // validated config string such as '1d', so narrow it at the boundary.
      expiresIn: this.configService.get<string>(
        'auth.tokenTtl',
        '1d',
      ) as JwtSignOptions['expiresIn'],
    });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        accountType: user.accountType,
        preferredLocale: user.preferredLocale,
        role: active?.role ?? null,
        organizationId: active?.organizationId ?? null,
      },
    };
  }
}

/** bcrypt hash of a value no user can supply. Used only for timing parity. */
const DUMMY_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7jkQ3q1nXKGGCXQzGQ2Q0kQfV0k9Zzy';

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** Team-member response shape. Strips passwordHash by construction. */
function toTeamMember(
  user: { id: string; email: string; fullName: string },
  membership: { id: string; organizationId: string; role: Role },
) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: membership.role,
    organizationId: membership.organizationId,
    membershipId: membership.id,
  };
}
