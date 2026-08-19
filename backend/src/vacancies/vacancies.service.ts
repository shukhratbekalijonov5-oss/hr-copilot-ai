import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { VacancyStatus } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { CreateVacancyDto } from './dto/create-vacancy.dto';
import type { UpdateVacancyDto } from './dto/update-vacancy.dto';
import type { QueryVacanciesDto } from './dto/query-vacancies.dto';
import type {
  CreateJobRequirementDto,
  UpdateJobRequirementDto,
} from './dto/job-requirement.dto';

@Injectable()
export class VacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  create(organizationId: string, createdById: string, dto: CreateVacancyDto) {
    return this.prisma.vacancy.create({
      data: {
        ...dto,
        status: dto.status ?? VacancyStatus.DRAFT,
        organizationId,
        createdById,
      },
      include: { requirements: true },
    });
  }

  async findAll(
    organizationId: string,
    query: QueryVacanciesDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.VacancyWhereInput = {
      // Tenant filter first and always — never overridable by query input.
      ...this.tenant.scope(organizationId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.department ? { department: query.department } : {}),
      ...(query.location ? { location: query.location } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vacancy.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { applications: true, requirements: true } } },
      }),
      this.prisma.vacancy.count({ where }),
    ]);

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(organizationId: string, id: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      include: {
        requirements: { orderBy: { type: 'asc' } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        _count: { select: { applications: true } },
      },
    });
    return this.tenant.assertFound(vacancy, 'Vacancy');
  }

  async update(organizationId: string, id: string, dto: UpdateVacancyDto) {
    await this.assertVacancyInOrg(organizationId, id);
    return this.prisma.vacancy.update({
      where: { id },
      data: dto,
      include: { requirements: true },
    });
  }

  /** Explicit lifecycle transition; always a human action. */
  async setStatus(organizationId: string, id: string, status: VacancyStatus) {
    const vacancy = this.tenant.assertFound(
      await this.prisma.vacancy.findFirst({
        where: { id, ...this.tenant.scope(organizationId) },
        select: { id: true, status: true },
      }),
      'Vacancy',
    );

    if (vacancy.status === status) return this.findOne(organizationId, id);
    if (vacancy.status === VacancyStatus.ARCHIVED) {
      throw new BadRequestException('An archived vacancy cannot change status');
    }

    return this.prisma.vacancy.update({ where: { id }, data: { status } });
  }

  async remove(organizationId: string, id: string) {
    await this.assertVacancyInOrg(organizationId, id);
    await this.prisma.vacancy.delete({ where: { id } });
    return { id, deleted: true };
  }

  // -- Job requirements ----------------------------------------------------
  // Requirements inherit tenancy from their vacancy, so every method resolves
  // the parent vacancy under the org filter before touching the child row.

  async addRequirement(
    organizationId: string,
    vacancyId: string,
    dto: CreateJobRequirementDto,
  ) {
    await this.assertVacancyInOrg(organizationId, vacancyId);
    return this.prisma.jobRequirement.create({ data: { ...dto, vacancyId } });
  }

  async listRequirements(organizationId: string, vacancyId: string) {
    await this.assertVacancyInOrg(organizationId, vacancyId);
    return this.prisma.jobRequirement.findMany({ where: { vacancyId } });
  }

  async updateRequirement(
    organizationId: string,
    vacancyId: string,
    requirementId: string,
    dto: UpdateJobRequirementDto,
  ) {
    await this.assertRequirementInOrg(organizationId, vacancyId, requirementId);
    return this.prisma.jobRequirement.update({
      where: { id: requirementId },
      data: dto,
    });
  }

  async removeRequirement(
    organizationId: string,
    vacancyId: string,
    requirementId: string,
  ) {
    await this.assertRequirementInOrg(organizationId, vacancyId, requirementId);
    await this.prisma.jobRequirement.delete({ where: { id: requirementId } });
    return { id: requirementId, deleted: true };
  }

  private async assertVacancyInOrg(organizationId: string, id: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      select: { id: true },
    });
    return this.tenant.assertFound(vacancy, 'Vacancy');
  }

  private async assertRequirementInOrg(
    organizationId: string,
    vacancyId: string,
    requirementId: string,
  ) {
    const requirement = await this.prisma.jobRequirement.findFirst({
      where: {
        id: requirementId,
        vacancyId,
        vacancy: this.tenant.scope(organizationId),
      },
      select: { id: true },
    });
    return this.tenant.assertFound(requirement, 'Job requirement');
  }
}
