import {
  BadRequestException,
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
import { AuthSessionService } from './auth-session.service';
import { AUTH_ERROR_CODES, authUnauthorized } from './auth-errors';
import { Locale, Role } from '../generated/prisma/enums';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../common/interfaces/authenticated-user.interface';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { InviteUserDto } from './dto/invite-user.dto';

/**
 * `role`/`organizationId` describe the ACTIVE organization membership (null
 * for a user with none, e.g. a job seeker). They are kept at this level for
 * frontend compatibility with the pre-migration single-org shape.
 */
export interface AuthTokenResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
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
    private readonly sessions: AuthSessionService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Two onboarding intents share this endpoint, both producing a normal User:
   *
   *  - Hiring: organizationName+organizationSlug present. Creates the user,
   *    the organization and its OWNER membership in one transaction.
   *  - Job seeking: no organization fields. Creates a bare user; a
   *    CandidateAccount is created separately via /candidate-account.
   */
  async register(
    dto: RegisterDto,
    context: SessionContext = {},
  ): Promise<AuthSessionResponse> {
    const email = normaliseEmail(dto.email);
    const wantsOrganization =
      dto.organizationName !== undefined || dto.organizationSlug !== undefined;
    if (
      wantsOrganization &&
      (!dto.organizationName?.trim() || !dto.organizationSlug?.trim())
    ) {
      throw new BadRequestException(
        'organizationName and organizationSlug must be provided together',
      );
    }

    const [existingUser, existingOrg] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      wantsOrganization
        ? this.prisma.organization.findUnique({
            where: { slug: dto.organizationSlug! },
          })
        : Promise.resolve(null),
    ]);
    if (existingUser)
      throw new ConflictException('Email is already registered');
    if (existingOrg)
      throw new ConflictException('Organization slug is already taken');

    const passwordHash = await this.hashPassword(dto.password);
    const userData = {
      email,
      passwordHash,
      fullName: dto.fullName,
      preferredLocale: dto.preferredLocale ?? Locale.en,
    };

    if (!wantsOrganization) {
      const user = await this.prisma.user.create({ data: userData });
      return this.openSession(user, null, dto.deviceName, context);
    }

    // No orphaned users or organizations on failure: one transaction.
    const { user, membership } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: userData });
      const organization = await tx.organization.create({
        data: { name: dto.organizationName!, slug: dto.organizationSlug! },
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
    return this.openSession(
      user,
      user.memberships[0] ?? null,
      dto.deviceName,
      context,
    );
  }

  /**
   * Rotates a refresh token: validates the session, replaces the secret and
   * returns a fresh short-lived access token. The new access token's `org`
   * claim comes from the SESSION's persisted context, re-checked against a
   * live membership — a revoked membership silently degrades the session to
   * organization-less instead of failing the refresh, because the user is
   * still a perfectly valid user (and possibly a job seeker).
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
   * An email that already has an account is added as a member of this
   * organization (multi-org is the normal case); their existing password and
   * name are left untouched — the supplied ones are ignored. A brand-new email
   * gets an account and the membership in one transaction.
   */
  async inviteUser(organizationId: string, dto: InviteUserDto) {
    const email = normaliseEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
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

    return {
      // Legacy-flat fields, kept for the pre-migration frontend contract.
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      preferredLocale: user.preferredLocale,
      role: active?.role ?? null,
      organizationId: active?.organizationId ?? null,
      organization: active ? active.organization : null,
      // Canonical multi-identity shape.
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        preferredLocale: user.preferredLocale,
      },
      candidateAccount: { exists: user.candidateAccount !== null },
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

  private async buildTokenResponse(
    user: {
      id: string;
      email: string;
      fullName: string;
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
