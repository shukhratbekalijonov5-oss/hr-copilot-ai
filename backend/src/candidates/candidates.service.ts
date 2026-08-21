import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { APPLICANT_CANDIDATE_SCOPE } from '../common/vacancy-access/applicant-scope';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { ApplicationSource } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { UpdateCandidateDto } from './dto/update-candidate.dto';
import type { QueryCandidatesDto } from './dto/query-candidates.dto';

/**
 * Candidate records only. There is deliberately no scoring, ranking or
 * shortlisting logic here: this service stores what the applicant and the
 * parser provide, and hiring decisions stay with the HR user.
 *
 * There is NO create method. Candidate records come into existence exactly one
 * way — a CandidateAccount applies to an OPEN vacancy — so this service reads,
 * edits and deletes what that flow produced.
 *
 * Every read is filtered to real applicants (APPLICANT_CANDIDATE_SCOPE):
 * records left behind by the removed recruiter-created-candidate feature keep
 * their rows but are not part of the working candidate universe any more.
 */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async findAll(
    organizationId: string,
    query: QueryCandidatesDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.CandidateWhereInput = {
      ...this.tenant.scope(organizationId),
      ...APPLICANT_CANDIDATE_SCOPE,
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

  /**
   * One applicant, with every evidence source they submitted to THIS
   * organization: the file copies and the link snapshots.
   *
   * `linkSources` is strictly READ-ONLY here and has no write counterpart
   * anywhere in the recruiter API. A recruiter sees the links a person chose
   * to send them, frozen as submitted — never the candidate's current personal
   * links, which live in a different table this query cannot reach.
   *
   * `sections` is deliberately not selected: the extracted text is retrieval
   * input, and a recruiter reads it through grounded answers and citations,
   * not as a raw dump of somebody's website.
   */
  async findOne(organizationId: string, id: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: {
        id,
        ...this.tenant.scope(organizationId),
        ...APPLICANT_CANDIDATE_SCOPE,
      },
      include: {
        applications: {
          // Only the applications this person actually submitted; a historical
          // recruiter-made association is not part of their pipeline.
          where: { source: ApplicationSource.DIRECT },
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
            applicationId: true,
            createdAt: true,
          },
        },
        linkSources: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            url: true,
            title: true,
            detectedType: true,
            status: true,
            charCount: true,
            pagesFetched: true,
            fetchedAt: true,
            applicationId: true,
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

  /** Shared applicant + tenancy check reused by other modules. */
  async assertCandidateInOrg(organizationId: string, id: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: {
        id,
        ...this.tenant.scope(organizationId),
        ...APPLICANT_CANDIDATE_SCOPE,
      },
      select: { id: true },
    });
    return this.tenant.assertFound(candidate, 'Candidate');
  }
}
