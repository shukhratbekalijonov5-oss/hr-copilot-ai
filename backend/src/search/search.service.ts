import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import {
  APPLICANT_APPLICATION_SCOPE,
  APPLICANT_CANDIDATE_SCOPE,
} from '../common/vacancy-access/applicant-scope';
import {
  AiServiceClient,
  AiServiceDisabledError,
  type EvidenceSearchHit,
  type EvidenceSearchResult as AiEvidenceSearchResult,
} from '../ai/ai-service.client';
import type { EvidenceSearchDto } from './dto/evidence-search.dto';

/** One passage, enriched with the candidate/document context the UI needs. */
export interface EvidenceResult {
  candidateId: string | null;
  candidateName: string | null;
  documentId: string;
  fileName: string | null;
  section: string | null;
  pageNumber: number | null;
  text: string;
  /**
   * How well this passage matches the query. NOT a candidate score, a hiring
   * score, or a probability of success.
   */
  relevance: { retrievalScore: number; rerankScore: number | null };
}

export interface EvidenceSearchResponse {
  query: string;
  /** Empty means no supporting evidence was found — not "rejected". */
  results: EvidenceResult[];
  reranked: boolean;
  totalConsidered: number;
  durationMs: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly ai: AiServiceClient,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly ownedVacancies: OwnedVacancyService,
  ) {}

  /**
   * Searches indexed applicant evidence for one organization.
   *
   * `organizationId` comes from the authenticated user and is the only tenant
   * the AI service is ever asked about, so a caller cannot reach another
   * organization's documents. This search only ever touches the ORG-SCOPED
   * collection (resume_chunks); candidates' private personal indexes are a
   * physically separate store no recruiter path can reach.
   *
   * WHAT is searchable: only evidence from real applications. Every org
   * document is now an apply-time snapshot of a resume the candidate chose to
   * submit — recruiter upload was removed — and hits are additionally filtered
   * to applicant candidates, so vectors left behind by the old
   * recruiter-uploaded files cannot resurface as an orphaned talent database.
   *
   * With `vacancyId` (which must be one of the CALLER'S OWN vacancies), the
   * results are restricted further to that vacancy's applicants: the backend
   * resolves the applicant set and filters the returned passages against it —
   * over-fetching from the index first so the trimmed result can still fill
   * the requested limit.
   */
  async searchEvidence(
    organizationId: string,
    userId: string,
    dto: EvidenceSearchDto,
  ): Promise<EvidenceSearchResponse> {
    // Selected-vacancy scoping: ownership first, then the association set.
    let vacancyCandidateIds: Set<string> | null = null;
    if (dto.vacancyId) {
      await this.ownedVacancies.requireOwned(
        userId,
        organizationId,
        dto.vacancyId,
      );
      const associations = await this.prisma.application.findMany({
        where: { vacancyId: dto.vacancyId, ...APPLICANT_APPLICATION_SCOPE },
        select: { candidateId: true },
      });
      vacancyCandidateIds = new Set(associations.map((a) => a.candidateId));
      if (vacancyCandidateIds.size === 0) {
        // No candidates in this vacancy yet — nothing can match.
        return {
          query: dto.query,
          results: [],
          reranked: false,
          totalConsidered: 0,
          durationMs: 0,
        };
      }
    }
    // Verify optional filters belong to this tenant before they leave the
    // backend, so a probing id cannot be used to test another org's data.
    if (dto.candidateId) {
      this.tenant.assertFound(
        await this.prisma.candidate.findFirst({
          where: {
            id: dto.candidateId,
            ...this.tenant.scope(organizationId),
            ...APPLICANT_CANDIDATE_SCOPE,
          },
          select: { id: true },
        }),
        'Candidate',
      );
    }
    if (dto.documentId) {
      this.tenant.assertFound(
        await this.prisma.document.findFirst({
          where: { id: dto.documentId, ...this.tenant.scope(organizationId) },
          select: { id: true },
        }),
        'Document',
      );
    }

    const limit = dto.limit ?? 10;
    let result: AiEvidenceSearchResult;
    try {
      result = await this.ai.searchEvidence(dto.query, {
        organizationId,
        candidateId: dto.candidateId,
        documentId: dto.documentId,
        // Vacancy filtering happens after retrieval, so ask the index for
        // more than the page size to keep the trimmed page full.
        limit: vacancyCandidateIds ? Math.min(50, limit * 5) : limit,
        rerank: dto.rerank ?? true,
      });
    } catch (error) {
      if (error instanceof AiServiceDisabledError) {
        throw new ServiceUnavailableException(
          'Evidence search is unavailable: the AI service is not configured',
        );
      }
      throw error;
    }

    // Applicant resolution doubles as the visibility filter: a hit whose
    // candidate is not a current applicant of this organization (a legacy
    // recruiter-uploaded file, or a foreign id the index returned) resolves to
    // no name and is dropped rather than shown without context.
    const names = await this.applicantNames(organizationId, result.hits);
    const hits = result.hits
      .filter((hit) => hit.documentId)
      .filter((hit) => hit.candidateId !== null && names.has(hit.candidateId))
      .filter(
        (hit) =>
          !vacancyCandidateIds || vacancyCandidateIds.has(hit.candidateId!),
      )
      .slice(0, limit);

    return {
      query: result.query,
      results: hits.map((hit) => ({
        candidateId: hit.candidateId,
        candidateName: names.get(hit.candidateId!) ?? null,
        documentId: hit.documentId,
        fileName: hit.fileName,
        section: hit.section,
        pageNumber: hit.pageNumber,
        text: hit.text,
        relevance: {
          retrievalScore: hit.retrievalScore,
          rerankScore: hit.rerankScore,
        },
      })),
      reranked: result.reranked,
      totalConsidered: result.totalCandidatesConsidered,
      durationMs: result.durationMs,
    };
  }

  /**
   * Resolves names for the APPLICANTS among these hits, scoped to the
   * organization. Membership in the returned map is what makes a hit
   * displayable: it is simultaneously the tenant check (a foreign candidateId
   * the index returned resolves to nothing, on top of Qdrant's own tenant
   * filter) and the applicant check.
   */
  private async applicantNames(
    organizationId: string,
    hits: EvidenceSearchHit[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(hits.map((h) => h.candidateId).filter(Boolean)),
    ] as string[];
    if (ids.length === 0) return new Map();

    const candidates = await this.prisma.candidate.findMany({
      where: {
        id: { in: ids },
        ...this.tenant.scope(organizationId),
        ...APPLICANT_CANDIDATE_SCOPE,
      },
      select: { id: true, fullName: true },
    });
    return new Map(candidates.map((c) => [c.id, c.fullName]));
  }
}
