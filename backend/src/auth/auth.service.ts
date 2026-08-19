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

interface ActiveMembership {
  organizationId: string;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipService,
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
  async register(dto: RegisterDto): Promise<AuthTokenResponse> {
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
      return this.buildTokenResponse(user, null);
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

    return this.buildTokenResponse(user, membership);
  }

  async login(dto: LoginDto): Promise<AuthTokenResponse> {
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
    return this.buildTokenResponse(user, user.memberships[0] ?? null);
  }

  /**
   * Activates another organization the caller belongs to, by returning a new
   * token whose `org` claim names it. The claim is only a pointer — every
   * org-scoped request re-verifies the membership row — but it is still only
   * issued against a real membership. A guessed/foreign organization id gets
   * 404 without confirming whether that organization exists.
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

    const response = await this.buildTokenResponse(user, membership);
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

  private async buildTokenResponse(
    user: {
      id: string;
      email: string;
      fullName: string;
      preferredLocale: Locale;
    },
    active: ActiveMembership | null,
  ): Promise<AuthTokenResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      ...(active ? { org: active.organizationId } : {}),
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
