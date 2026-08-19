import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
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
  ) {}

  /**
   * Searches indexed resume evidence for one organization.
   *
   * `organizationId` comes from the authenticated user and is the only tenant
   * the AI service is ever asked about, so a caller cannot reach another
   * organization's documents.
   */
  async searchEvidence(
    organizationId: string,
    dto: EvidenceSearchDto,
  ): Promise<EvidenceSearchResponse> {
    // Verify optional filters belong to this tenant before they leave the
    // backend, so a probing id cannot be used to test another org's data.
    if (dto.candidateId) {
      this.tenant.assertFound(
        await this.prisma.candidate.findFirst({
          where: { id: dto.candidateId, ...this.tenant.scope(organizationId) },
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

    let result: AiEvidenceSearchResult;
    try {
      result = await this.ai.searchEvidence(dto.query, {
        organizationId,
        candidateId: dto.candidateId,
        documentId: dto.documentId,
        limit: dto.limit ?? 10,
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

    const hits = result.hits.filter((hit) => hit.documentId);
    const names = await this.candidateNames(organizationId, hits);

    return {
      query: result.query,
      results: hits.map((hit) => ({
        candidateId: hit.candidateId,
        candidateName: hit.candidateId
          ? (names.get(hit.candidateId) ?? null)
          : null,
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
   * Resolves candidate names, scoped to the organization.
   *
   * This is also a second isolation check: a candidateId the AI service
   * returned that does not belong to this tenant simply resolves to no name,
   * and the id was already tenant-filtered in Qdrant.
   */
  private async candidateNames(
    organizationId: string,
    hits: EvidenceSearchHit[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(hits.map((h) => h.candidateId).filter(Boolean)),
    ] as string[];
    if (ids.length === 0) return new Map();

    const candidates = await this.prisma.candidate.findMany({
      where: { id: { in: ids }, ...this.tenant.scope(organizationId) },
      select: { id: true, fullName: true },
    });
    return new Map(candidates.map((c) => [c.id, c.fullName]));
  }
}
