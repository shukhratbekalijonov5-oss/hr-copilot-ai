import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import type { UpdateOrganizationDto } from './dto/update-organization.dto';

/**
 * The caller's own organization — and only ever that one.
 *
 * There is deliberately no findAll and no findOne(id): the organization is
 * always resolved from the authenticated user's token, so there is no route
 * through which one tenant can read another's record.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async findCurrent(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            members: true,
            vacancies: true,
            candidates: true,
            documents: true,
          },
        },
      },
    });
    return this.tenant.assertFound(organization, 'Organization');
  }

  async updateCurrent(organizationId: string, dto: UpdateOrganizationDto) {
    // Confirm it exists before updating so a stale token yields 404, not a
    // Prisma "record not found" crash.
    await this.findCurrent(organizationId);

    return this.prisma.organization.update({
      where: { id: organizationId },
      data: dto,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** Headline counts for the organization dashboard. */
  async stats(organizationId: string) {
    const scope = this.tenant.scope(organizationId);

    const [
      users,
      vacancies,
      openVacancies,
      candidates,
      applications,
      documents,
    ] = await this.prisma.$transaction([
      // Team size = memberships of this organization. A CandidateAccount-only
      // user is never counted: they have no membership row.
      this.prisma.organizationMember.count({ where: scope }),
      this.prisma.vacancy.count({ where: scope }),
      this.prisma.vacancy.count({ where: { ...scope, status: 'OPEN' } }),
      this.prisma.candidate.count({ where: scope }),
      this.prisma.application.count({
        where: { vacancy: scope, candidate: scope },
      }),
      this.prisma.document.count({ where: scope }),
    ]);

    return {
      users,
      vacancies,
      openVacancies,
      candidates,
      applications,
      documents,
    };
  }
}
