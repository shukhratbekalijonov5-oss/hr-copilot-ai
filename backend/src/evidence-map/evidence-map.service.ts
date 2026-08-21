import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hostnameOf } from '../web-ingestion/url-policy';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import {
  AiServiceClient,
  AiServiceDisabledError,
  type AiCitation,
  type AiEvidenceMapResult,
  type EvidenceMappingStatus,
  type SupportedLocale,
} from '../ai/ai-service.client';
import { CandidateEvidenceLifecycleService } from '../candidate-evidence/candidate-evidence.service';
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
    private readonly ownedVacancies: OwnedVacancyService,
    private readonly evidence: CandidateEvidenceLifecycleService,
  ) {}

  /** Runs the mapping and persists the result. */
  async run(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
    locale: SupportedLocale = 'en',
  ) {
    const { vacancy } = await this.assertScope(
      organizationId,
      userId,
      candidateId,
      vacancyId,
    );

    if (vacancy.requirements.length === 0) {
      throw new BadRequestException(
        'This vacancy has no job requirements to map evidence against',
      );
    }

    // Only the candidate's SURVIVING submitted sources may be mapped. A
    // requirement must never come back EVIDENCE_FOUND on the strength of a
    // passage from a file or link the candidate has since withdrawn.
    const allowedSourceIds = await this.evidence.activeApplicationSourceIds(
      organizationId,
      candidateId,
    );

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
        allowedSourceIds,
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

    return this.read(organizationId, userId, candidateId, vacancyId);
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

        // A citation names a SOURCE, which is either a submitted file or a
        // submitted link — the AI service uses one key space for both. Resolve
        // the id against each table to find out which, and store only sources
        // that still exist in this organization: the AI service indexes
        // independently, so a source deleted since indexing would otherwise
        // leave a citation pointing at nothing.
        const sourceIds = [
          ...new Set(mapping.evidence.map((e) => e.documentId)),
        ];
        const [documents, linkSources] = await Promise.all([
          tx.document.findMany({
            where: { id: { in: sourceIds }, organizationId },
            select: { id: true },
          }),
          tx.applicationLinkSource.findMany({
            where: { id: { in: sourceIds }, organizationId },
            select: { id: true },
          }),
        ]);
        const knownDocuments = new Set(documents.map((d) => d.id));
        const knownLinks = new Set(linkSources.map((s) => s.id));

        await tx.candidateEvidence.createMany({
          data: mapping.evidence
            .filter(
              (citation) =>
                knownDocuments.has(citation.documentId) ||
                knownLinks.has(citation.documentId),
            )
            .map((citation) => ({
              organizationId,
              candidateId,
              vacancyId,
              requirementId: mapping.requirementId,
              // Exactly one is set — the exclusivity the schema documents but
              // cannot express.
              documentId: knownDocuments.has(citation.documentId)
                ? citation.documentId
                : null,
              linkSourceId: knownLinks.has(citation.documentId)
                ? citation.documentId
                : null,
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
  async read(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
  ) {
    const { vacancy, candidate } = await this.assertScope(
      organizationId,
      userId,
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
            linkSourceId: true,
            pageNumber: true,
            section: true,
            text: true,
            sourceChunkId: true,
            document: { select: { originalFileName: true } },
            // The URL and title are the frozen ones from the submission, so a
            // citation stays checkable even after the candidate changed or
            // removed the link from their own profile.
            linkSource: { select: { title: true, url: true } },
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
            // One field for the source id whichever kind it is, so the UI can
            // address both uniformly — the same shape the AI service uses.
            documentId: e.documentId ?? e.linkSourceId!,
            sourceType: e.linkSourceId ? ('URL' as const) : ('FILE' as const),
            fileName:
              e.document?.originalFileName ??
              e.linkSource?.title ??
              hostnameOf(e.linkSource?.url ?? ''),
            sourceUrl: e.linkSource?.url ?? null,
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
  /**
   * The vacancy-scoped workspace gate for JD evidence (and therefore Compare):
   * the vacancy must be the CALLER'S OWN (404 foreign, 403 VACANCY_NOT_OWNED
   * same-org), the candidate must exist in the org (404), and the candidate
   * must be ASSOCIATED with the selected vacancy (403
   * CANDIDATE_NOT_IN_VACANCY) — Compare can never pull in a candidate from
   * outside the selected vacancy. The stored mapping itself is keyed by
   * (candidate, vacancy, requirement), so results computed for vacancy A are
   * structurally invisible under vacancy B.
   */
  private async assertScope(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
  ) {
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);
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
    await this.ownedVacancies.assertCandidateInVacancy(vacancyId, candidateId);
    return { candidate: candidate!, vacancy: vacancy! };
  }
}
