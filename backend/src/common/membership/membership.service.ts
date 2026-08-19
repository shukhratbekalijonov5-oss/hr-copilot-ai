import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '../../generated/prisma/enums';

/**
 * The single authority on "who belongs to which organization, as what".
 *
 * Reads are deliberately uncached: authorization consults the database on
 * every org-scoped request (one indexed unique lookup), so removing or
 * demoting a member takes effect on their next request — a token can name an
 * active organization but can never vouch for a membership.
 */
@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's membership in one organization, or null. */
  findMembership(userId: string, organizationId: string) {
    return this.prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
  }

  /** All memberships with their organizations, oldest first. */
  listForUser(userId: string) {
    return this.prisma.organizationMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  /**
   * Guards the last-OWNER invariant against the CURRENT database state — never
   * against a token or request-time cache. Excluding the target lets "demote
   * this owner" and "remove this owner" share the check.
   */
  async assertNotLastOwner(
    organizationId: string,
    excludingUserId: string,
  ): Promise<void> {
    const remainingOwners = await this.prisma.organizationMember.count({
      where: {
        organizationId,
        role: Role.OWNER,
        userId: { not: excludingUserId },
      },
    });
    if (remainingOwners === 0) {
      throw new BadRequestException(
        'This organization must keep at least one OWNER',
      );
    }
  }
}
