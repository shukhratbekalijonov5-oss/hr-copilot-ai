import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { MembershipService } from '../common/membership/membership.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { Role } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { QueryUsersDto } from './dto/query-users.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

/**
 * Team directory of ONE organization — i.e. its OrganizationMember rows joined
 * with account info. Routes still address members by user id (the stable
 * public identifier), but every operation resolves and mutates the MEMBERSHIP:
 * removing a teammate deletes their membership, never their account, which may
 * hold other organizations and a CandidateAccount.
 *
 * `passwordHash` is never selected, so it cannot leak through any response
 * shape here. Membership creation lives in AuthModule (register / invite).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly memberships: MembershipService,
  ) {}

  /** Columns safe to return. Note the absence of passwordHash. */
  private static readonly MEMBER_SELECT = {
    id: true,
    role: true,
    createdAt: true,
    updatedAt: true,
    organizationId: true,
    user: {
      select: {
        id: true,
        email: true,
        fullName: true,
        createdAt: true,
        updatedAt: true,
      },
    },
  } as const;

  async findAll(
    organizationId: string,
    query: QueryUsersDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.OrganizationMemberWhereInput = {
      ...this.tenant.scope(organizationId),
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.organizationMember.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'asc' },
        select: UsersService.MEMBER_SELECT,
      }),
      this.prisma.organizationMember.count({ where }),
    ]);

    return paginated(data.map(flattenMember), total, query.page, query.limit);
  }

  async findOne(organizationId: string, userId: string) {
    const membership = await this.prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: UsersService.MEMBER_SELECT,
    });
    return flattenMember(this.tenant.assertFound(membership, 'User'));
  }

  /**
   * Updates a teammate's name or role.
   *
   * Two invariants are enforced here rather than in a guard, because both
   * depend on the current database state:
   *   - nobody may change their own role (no self-promotion, and no
   *     self-demotion that could sidestep the ownership rules);
   *   - the last OWNER may not be demoted, which would leave the organization
   *     with no one able to administer it.
   */
  async update(
    organizationId: string,
    actorId: string,
    userId: string,
    dto: UpdateUserDto,
  ) {
    const membership = this.tenant.assertFound(
      await this.prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { id: true, userId: true, role: true },
      }),
      'User',
    );

    if (dto.role !== undefined && dto.role !== membership.role) {
      if (membership.userId === actorId) {
        throw new ForbiddenException('You cannot change your own role');
      }
      if (membership.role === Role.OWNER) {
        await this.memberships.assertNotLastOwner(
          organizationId,
          membership.userId,
        );
      }
    }

    const updated = await this.prisma.organizationMember.update({
      where: { id: membership.id },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        // fullName lives on the account; kept editable here to preserve the
        // existing team-management behaviour.
        ...(dto.fullName !== undefined
          ? { user: { update: { fullName: dto.fullName } } }
          : {}),
      },
      select: UsersService.MEMBER_SELECT,
    });
    return flattenMember(updated);
  }

  /**
   * Removes a teammate FROM THIS ORGANIZATION: deletes the membership row.
   * The account itself survives — it may belong to other organizations or be
   * a job seeker.
   */
  async remove(organizationId: string, actorId: string, userId: string) {
    const membership = this.tenant.assertFound(
      await this.prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { id: true, userId: true, role: true },
      }),
      'User',
    );

    if (membership.userId === actorId) {
      throw new BadRequestException(
        'You cannot remove yourself from the organization',
      );
    }
    if (membership.role === Role.OWNER) {
      await this.memberships.assertNotLastOwner(
        organizationId,
        membership.userId,
      );
    }

    await this.prisma.organizationMember.delete({
      where: { id: membership.id },
    });
    return { id: userId, deleted: true };
  }
}

/**
 * Flattens a membership row into the team-member shape the frontend already
 * knows (user fields + role at the top level), plus the membership id.
 */
function flattenMember(member: {
  id: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
  organizationId: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    createdAt: Date;
    updatedAt: Date;
  };
}) {
  return {
    id: member.user.id,
    email: member.user.email,
    fullName: member.user.fullName,
    role: member.role,
    organizationId: member.organizationId,
    membershipId: member.id,
    joinedAt: member.createdAt,
    createdAt: member.user.createdAt,
    updatedAt: member.updatedAt,
  };
}
