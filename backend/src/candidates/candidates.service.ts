import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import type { Prisma } from '../generated/prisma/client';
import type { CreateCandidateDto } from './dto/create-candidate.dto';
import type { UpdateCandidateDto } from './dto/update-candidate.dto';
import type { QueryCandidatesDto } from './dto/query-candidates.dto';

/**
 * Candidate records only. There is deliberately no scoring, ranking or
 * shortlisting logic here: this service stores what humans and the parser
 * provide, and hiring decisions stay with the HR user.
 */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  create(organizationId: string, dto: CreateCandidateDto) {
    return this.prisma.candidate.create({ data: { ...dto, organizationId } });
  }

  async findAll(
    organizationId: string,
    query: QueryCandidatesDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CandidateWhereInput = {
      ...this.tenant.scope(organizationId),
      ...(query.location ? { location: query.location } : {}),
      ...(query.currentTitle
        ? {
            currentTitle: { contains: query.currentTitle, mode: 'insensitive' },
          }
        : {}),
      ...(query.minExperienceYears !== undefined
        ? { totalExperienceYears: { gte: query.minExperienceYears } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { currentTitle: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.candidate.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { applications: true, documents: true, evidence: true },
          },
        },
      }),
      this.prisma.candidate.count({ where }),
    ]);

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(organizationId: string, id: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      include: {
        applications: {
          include: {
            vacancy: { select: { id: true, title: true, status: true } },
          },
        },
        documents: {
          select: {
            id: true,
            type: true,
            originalFileName: true,
            status: true,
            pageCount: true,
            createdAt: true,
          },
        },
      },
    });
    return this.tenant.assertFound(candidate, 'Candidate');
  }

  async update(organizationId: string, id: string, dto: UpdateCandidateDto) {
    await this.assertCandidateInOrg(organizationId, id);
    return this.prisma.candidate.update({ where: { id }, data: dto });
  }

  async remove(organizationId: string, id: string) {
    await this.assertCandidateInOrg(organizationId, id);
    await this.prisma.candidate.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Shared tenancy check reused by other modules (documents, applications). */
  async assertCandidateInOrg(organizationId: string, id: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      select: { id: true },
    });
    return this.tenant.assertFound(candidate, 'Candidate');
  }
}
