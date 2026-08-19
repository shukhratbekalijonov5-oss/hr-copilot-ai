import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import {
  AiServiceClient,
  AiServiceDisabledError,
  type AiCitation,
  type AiEvidenceMapResult,
  type EvidenceMappingStatus,
  type SupportedLocale,
} from '../ai/ai-service.client';
import { EvidenceType } from '../generated/prisma/enums';

/**
 * JD -> candidate evidence mapping and its persistence.
 *
 * ## What is stored where
 *
 * Qdrant holds every searchable chunk of every document. PostgreSQL holds only
 * *requirement-linked* evidence — the passages a mapping actually selected for
 * a specific requirement. An ordinary semantic search creates no rows at all.
 *
 * Copying every retrieved chunk into PostgreSQL would duplicate the index into
 * a store that cannot search it, and would grow without bound as recruiters
 * browse.
 *
 * ## Idempotency
 *
 * A mapping is keyed by (candidate, vacancy, requirement). Re-running replaces
 * the row and deletes its previous evidence before inserting the new set, so
 * repeated runs converge rather than accumulate.
 */
@Injectable()
export class EvidenceMapService {
  private readonly logger = new Logger(EvidenceMapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly ai: AiServiceClient,
  ) {}

  /** Runs the mapping and persists the result. */
  async run(
    organizationId: string,
    candidateId: string,
    vacancyId: string,
    locale: SupportedLocale = 'en',
  ) {
    const { vacancy } = await this.assertScope(
      organizationId,
      candidateId,
      vacancyId,
    );

    if (vacancy.requirements.length === 0) {
      throw new BadRequestException(
        'This vacancy has no job requirements to map evidence against',
      );
    }

    let result: AiEvidenceMapResult;
    try {
      result = await this.ai.mapEvidence({
        organizationId,
        candidateId,
        vacancyId,
        requirements: vacancy.requirements.map((r) => ({
          requirementId: r.id,
          text: r.text,
          type: r.type,
          required: r.required,
        })),
        locale,
      });
    } catch (error) {
      if (error instanceof AiServiceDisabledError) {
        throw new ServiceUnavailableException(
          'Evidence mapping is unavailable: the AI service is not configured',
        );
      }
      throw error;
    }

    await this.persist(
      organizationId,
      candidateId,
      vacancyId,
      result.requirements,
    );

    this.logger.log(
      `Mapped ${result.requirements.length} requirement(s) for candidate ` +
        `${candidateId} on vacancy ${vacancyId}`,
    );

    return this.read(organizationId, candidateId, vacancyId);
  }

  /**
   * Persists one mapping run.
   *
   * Each requirement is written in its own transaction: a failure part-way
   * through leaves earlier requirements correctly stored rather than rolling
   * back work that was valid.
   */
  private async persist(
    organizationId: string,
    candidateId: string,
    vacancyId: string,
    mappings: {
      requirementId: string;
      status: EvidenceMappingStatus;
      reason: string;
      matchedTerms: string[];
      missingTerms: string[];
      evidence: AiCitation[];
    }[],
  ): Promise<void> {
    for (const mapping of mappings) {
      await this.prisma.$transaction(async (tx) => {
        const map = await tx.requirementEvidenceMap.upsert({
          where: {
            candidateId_vacancyId_requirementId: {
              candidateId,
              vacancyId,
              requirementId: mapping.requirementId,
            },
          },
          create: {
            organizationId,
            candidateId,
            vacancyId,
            requirementId: mapping.requirementId,
            status: mapping.status,
            reason: mapping.reason,
            matchedTerms: mapping.matchedTerms,
            missingTerms: mapping.missingTerms,
          },
          update: {
            status: mapping.status,
            reason: mapping.reason,
            matchedTerms: mapping.matchedTerms,
            missingTerms: mapping.missingTerms,
          },
        });

        // Replace rather than append: a re-run must converge, not accumulate.
        await tx.candidateEvidence.deleteMany({
          where: { requirementMapId: map.id },
        });

        if (mapping.evidence.length === 0) return;

        // Only evidence whose document still exists in this organization is
        // stored — the AI service indexes independently, so a document deleted
        // since indexing could otherwise create a dangling row.
        const documentIds = [
          ...new Set(mapping.evidence.map((e) => e.documentId)),
        ];
        const documents = await tx.document.findMany({
          where: { id: { in: documentIds }, organizationId },
          select: { id: true },
        });
        const known = new Set(documents.map((d) => d.id));

        await tx.candidateEvidence.createMany({
          data: mapping.evidence
            .filter((citation) => known.has(citation.documentId))
            .map((citation) => ({
              organizationId,
              candidateId,
              vacancyId,
              requirementId: mapping.requirementId,
              documentId: citation.documentId,
              pageNumber: citation.pageNumber,
              section: citation.section,
              text: citation.text,
              evidenceType: EvidenceType.OTHER,
              sourceChunkId: citation.chunkId,
              requirementMapId: map.id,
            })),
        });
      });
    }
  }

  /** Domain-shaped read: requirements with their status and evidence. */
  async read(organizationId: string, candidateId: string, vacancyId: string) {
    const { vacancy, candidate } = await this.assertScope(
      organizationId,
      candidateId,
      vacancyId,
    );

    const maps = await this.prisma.requirementEvidenceMap.findMany({
      where: {
        ...this.tenant.scope(organizationId),
        candidateId,
        vacancyId,
      },
      include: {
        evidence: {
          select: {
            id: true,
            documentId: true,
            pageNumber: true,
            section: true,
            text: true,
            sourceChunkId: true,
            document: { select: { originalFileName: true } },
          },
        },
      },
    });

    const byRequirement = new Map(maps.map((m) => [m.requirementId, m]));

    return {
      candidate: { id: candidate.id, fullName: candidate.fullName },
      vacancy: { id: vacancy.id, title: vacancy.title },
      // Every requirement appears, mapped or not, so the UI does not have to
      // guess why one is missing.
      requirements: vacancy.requirements.map((requirement) => {
        const mapped = byRequirement.get(requirement.id);
        return {
          requirement: {
            id: requirement.id,
            text: requirement.text,
            type: requirement.type,
            required: requirement.required,
          },
          status: mapped?.status ?? null,
          reason: mapped?.reason ?? null,
          matchedTerms: mapped?.matchedTerms ?? [],
          missingTerms: mapped?.missingTerms ?? [],
          mappedAt: mapped?.updatedAt ?? null,
          evidence: (mapped?.evidence ?? []).map((e) => ({
            id: e.id,
            documentId: e.documentId,
            fileName: e.document.originalFileName,
            pageNumber: e.pageNumber,
            section: e.section,
            text: e.text,
            sourceChunkId: e.sourceChunkId,
          })),
        };
      }),
    };
  }

  /** Both candidate and vacancy must belong to the caller's organization. */
  private async assertScope(
    organizationId: string,
    candidateId: string,
    vacancyId: string,
  ) {
    const [candidate, vacancy] = await Promise.all([
      this.prisma.candidate.findFirst({
        where: { id: candidateId, ...this.tenant.scope(organizationId) },
        select: { id: true, fullName: true },
      }),
      this.prisma.vacancy.findFirst({
        where: { id: vacancyId, ...this.tenant.scope(organizationId) },
        select: {
          id: true,
          title: true,
          requirements: {
            select: { id: true, text: true, type: true, required: true },
            orderBy: { type: 'asc' },
          },
        },
      }),
    ]);

    this.tenant.assertFound(candidate, 'Candidate');
    this.tenant.assertFound(vacancy, 'Vacancy');
    return { candidate: candidate!, vacancy: vacancy! };
  }
}
