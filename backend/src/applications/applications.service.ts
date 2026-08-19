import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { ApplicationStatus } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { CreateApplicationDto } from './dto/create-application.dto';
import type { QueryApplicationsDto } from './dto/query-applications.dto';

/**
 * Applications carry no organizationId column of their own — they inherit
 * tenancy from both the vacancy and the candidate. Every query therefore
 * filters through those relations, and creation verifies that BOTH parents
 * belong to the caller's organization before linking them.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async create(organizationId: string, dto: CreateApplicationDto) {
    const [vacancy, candidate] = await Promise.all([
      this.prisma.vacancy.findFirst({
        where: { id: dto.vacancyId, ...this.tenant.scope(organizationId) },
        select: { id: true },
      }),
      this.prisma.candidate.findFirst({
        where: { id: dto.candidateId, ...this.tenant.scope(organizationId) },
        select: { id: true },
      }),
    ]);

    this.tenant.assertFound(vacancy, 'Vacancy');
    this.tenant.assertFound(candidate, 'Candidate');

    const existing = await this.prisma.application.findUnique({
      where: {
        vacancyId_candidateId: {
          vacancyId: dto.vacancyId,
          candidateId: dto.candidateId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Candidate is already attached to this vacancy');
    }

    return this.prisma.application.create({
      data: {
        vacancyId: dto.vacancyId,
        candidateId: dto.candidateId,
        status: dto.status ?? ApplicationStatus.NEW,
      },
      include: {
        vacancy: { select: { id: true, title: true, status: true } },
        candidate: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async findAll(
    organizationId: string,
    query: QueryApplicationsDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.ApplicationWhereInput = {
      // Tenancy through the relations, applied unconditionally.
      vacancy: this.tenant.scope(organizationId),
      candidate: this.tenant.scope(organizationId),
      ...(query.vacancyId ? { vacancyId: query.vacancyId } : {}),
      ...(query.candidateId ? { candidateId: query.candidateId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          vacancy: { select: { id: true, title: true, status: true } },
          candidate: {
            select: { id: true, fullName: true, email: true, currentTitle: true },
          },
        },
      }),
      this.prisma.application.count({ where }),
    ]);

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(organizationId: string, id: string) {
    const application = await this.prisma.application.findFirst({
      where: {
        id,
        vacancy: this.tenant.scope(organizationId),
        candidate: this.tenant.scope(organizationId),
      },
      include: {
        vacancy: { include: { requirements: true } },
        candidate: {
          include: {
            documents: {
              select: {
                id: true,
                type: true,
                originalFileName: true,
                status: true,
                pageCount: true,
              },
            },
          },
        },
      },
    });
    return this.tenant.assertFound(application, 'Application');
  }

  /**
   * Human-controlled stage change. Any status is reachable from any other —
   * HR may reopen, withdraw or correct a mistake — but only a person can
   * trigger it. No automated caller invokes this method.
   */
  async updateStatus(
    organizationId: string,
    id: string,
    status: ApplicationStatus,
  ) {
    const application = await this.prisma.application.findFirst({
      where: {
        id,
        vacancy: this.tenant.scope(organizationId),
        candidate: this.tenant.scope(organizationId),
      },
      select: { id: true },
    });
    this.tenant.assertFound(application, 'Application');

    return this.prisma.application.update({
      where: { id },
      data: { status },
      include: {
        vacancy: { select: { id: true, title: true } },
        candidate: { select: { id: true, fullName: true } },
      },
    });
  }

  async remove(organizationId: string, id: string) {
    const application = await this.prisma.application.findFirst({
      where: {
        id,
        vacancy: this.tenant.scope(organizationId),
        candidate: this.tenant.scope(organizationId),
      },
      select: { id: true },
    });
    this.tenant.assertFound(application, 'Application');

    await this.prisma.application.delete({ where: { id } });
    return { id, deleted: true };
  }
}
