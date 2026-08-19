import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { EvidenceType } from '../generated/prisma/enums';
import type { CreateEvidenceDto } from './dto/create-evidence.dto';
import { QueryEvidenceDto } from './dto/query-evidence.dto';

/**
 * Candidate evidence: passages extracted from documents, each traceable back to
 * a document and page so an HR user can verify it themselves.
 *
 * This service stores and reads evidence. It does not rank candidates, score
 * them, or derive a recommendation — that stays a human judgement.
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  /**
   * Persists one evidence row. Every referenced entity is re-checked against
   * the caller's organization first, so evidence can never cross tenants even
   * if the AI service were to hand back a foreign id.
   */
  async create(organizationId: string, dto: CreateEvidenceDto) {
    const [candidate, document, vacancy, requirement] = await Promise.all([
      this.prisma.candidate.findFirst({
        where: { id: dto.candidateId, ...this.tenant.scope(organizationId) },
        select: { id: true },
      }),
      this.prisma.document.findFirst({
        where: { id: dto.documentId, ...this.tenant.scope(organizationId) },
        select: { id: true },
      }),
      dto.vacancyId
        ? this.prisma.vacancy.findFirst({
            where: { id: dto.vacancyId, ...this.tenant.scope(organizationId) },
            select: { id: true },
          })
        : Promise.resolve(null),
      dto.requirementId
        ? this.prisma.jobRequirement.findFirst({
            where: {
              id: dto.requirementId,
              vacancy: this.tenant.scope(organizationId),
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    this.tenant.assertFound(candidate, 'Candidate');
    this.tenant.assertFound(document, 'Document');
    if (dto.vacancyId) this.tenant.assertFound(vacancy, 'Vacancy');
    if (dto.requirementId) this.tenant.assertFound(requirement, 'Job requirement');

    return this.prisma.candidateEvidence.create({
      data: {
        organizationId,
        candidateId: dto.candidateId,
        documentId: dto.documentId,
        vacancyId: dto.vacancyId ?? null,
        requirementId: dto.requirementId ?? null,
        pageNumber: dto.pageNumber ?? null,
        section: dto.section ?? null,
        text: dto.text,
        evidenceType: dto.evidenceType ?? EvidenceType.OTHER,
      },
    });
  }

  async findAll(
    organizationId: string,
    query: QueryEvidenceDto,
  ): Promise<PaginatedResult<unknown>> {
    const where = {
      ...this.tenant.scope(organizationId),
      ...(query.candidateId ? { candidateId: query.candidateId } : {}),
      ...(query.vacancyId ? { vacancyId: query.vacancyId } : {}),
      ...(query.requirementId ? { requirementId: query.requirementId } : {}),
      ...(query.documentId ? { documentId: query.documentId } : {}),
      ...(query.evidenceType ? { evidenceType: query.evidenceType } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.candidateEvidence.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          // Document/page metadata so the UI can deep-link to the source.
          document: {
            select: {
              id: true,
              originalFileName: true,
              mimeType: true,
              pageCount: true,
              type: true,
            },
          },
          requirement: { select: { id: true, text: true, type: true, required: true } },
        },
      }),
      this.prisma.candidateEvidence.count({ where }),
    ]);

    return paginated(data, total, query.page, query.limit);
  }

  /** All evidence recorded for one candidate. */
  async findByCandidate(
    organizationId: string,
    candidateId: string,
    query: QueryEvidenceDto,
  ) {
    return this.findAll(organizationId, withFilter(query, { candidateId }));
  }

  /** Evidence gathered against one specific job requirement. */
  async findByRequirement(
    organizationId: string,
    requirementId: string,
    query: QueryEvidenceDto,
  ) {
    const requirement = await this.prisma.jobRequirement.findFirst({
      where: { id: requirementId, vacancy: this.tenant.scope(organizationId) },
      select: { id: true },
    });
    this.tenant.assertFound(requirement, 'Job requirement');
    return this.findAll(organizationId, withFilter(query, { requirementId }));
  }

  async findOne(organizationId: string, id: string) {
    const evidence = await this.prisma.candidateEvidence.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      include: {
        document: {
          select: {
            id: true,
            originalFileName: true,
            mimeType: true,
            pageCount: true,
            type: true,
            status: true,
          },
        },
        candidate: { select: { id: true, fullName: true } },
        requirement: { select: { id: true, text: true, type: true } },
      },
    });
    return this.tenant.assertFound(evidence, 'Evidence');
  }
}

/**
 * Returns a copy of the query with extra filters applied.
 *
 * A plain object spread would drop PaginationQueryDto's `skip` getter, so the
 * copy is rebuilt on the prototype.
 */
function withFilter(
  query: QueryEvidenceDto,
  overrides: Partial<QueryEvidenceDto>,
): QueryEvidenceDto {
  return Object.assign(new QueryEvidenceDto(), query, overrides);
}
