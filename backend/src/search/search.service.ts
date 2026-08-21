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
import type { EvidenceSourceType } from '../common/evidence/evidence-source';
import type { EvidenceSearchDto } from './dto/evidence-search.dto';

/**
 * One passage, enriched with the candidate/source context the UI needs.
 *
 * `documentId` is the SOURCE key — a Document id for a file, an
 * ApplicationLinkSource id for a link — so the result card can address either
 * kind uniformly. `sourceType` tells the UI which one it is, and therefore
 * whether "page 2" or "portfolio.example.com/projects" is the right thing to
 * show underneath.
 */
export interface EvidenceResult {
  candidateId: string | null;
  candidateName: string | null;
  documentId: string;
  fileName: string | null;
  section: string | null;
  pageNumber: number | null;
  text: string;
  sourceType: EvidenceSourceType;
  sourceTitle: string | null;
  sourceUrl: string | null;
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
      // A source filter may name either kind of evidence — a submitted file or
      // a submitted link — because both occupy one key space in the index.
      // Either way it must belong to THIS organization before it reaches the
      // AI service, so a probing id cannot be used to test another org's data.
      const [document, linkSource] = await Promise.all([
        this.prisma.document.findFirst({
          where: { id: dto.documentId, ...this.tenant.scope(organizationId) },
          select: { id: true },
        }),
        this.prisma.applicationLinkSource.findFirst({
          where: { id: dto.documentId, ...this.tenant.scope(organizationId) },
          select: { id: true },
        }),
      ]);
      this.tenant.assertFound(document ?? linkSource, 'Document');
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
    //
    // The SOURCE filter alongside it is the deletion guarantee. This search is
    // organization-wide, so there is no small set of allowed source ids to send
    // the index — the surviving set is resolved for the handful of sources the
    // index actually returned instead. A term that exists only inside a file or
    // link the candidate has withdrawn therefore stops finding them, whether or
    // not the vectors have physically been evicted yet.
    const [names, liveSources] = await Promise.all([
      this.applicantNames(organizationId, result.hits),
      this.survivingSourceIds(organizationId, result.hits),
    ]);
    const hits = result.hits
      .filter((hit) => hit.documentId)
      .filter((hit) => liveSources.has(hit.documentId))
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
        // Chunks indexed before URL evidence existed carry no sourceType;
        // they are files, and defaulting keeps them rendering correctly
        // without a reindex.
        sourceType: hit.sourceType ?? 'FILE',
        sourceTitle: hit.sourceTitle ?? hit.fileName,
        sourceUrl: hit.sourceUrl ?? null,
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
   * Which of these hits' sources STILL EXIST in this organization.
   *
   * A hit's `documentId` is the source key for either kind — a submitted file
   * or a submitted link snapshot — so both tables are consulted and the result
   * is one set of ids. Only the ids the index actually returned are looked up,
   * so this is a bounded query however large the organization's corpus is.
   *
   * This is the search-side half of the rule that deleted evidence stops
   * existing: the vectors may outlive the row for as long as an eviction is
   * retrying, and this makes them unusable in the meantime.
   */
  private async survivingSourceIds(
    organizationId: string,
    hits: EvidenceSearchHit[],
  ): Promise<Set<string>> {
    const ids = [...new Set(hits.map((h) => h.documentId).filter(Boolean))];
    if (ids.length === 0) return new Set();

    const [documents, linkSources] = await Promise.all([
      this.prisma.document.findMany({
        where: { id: { in: ids }, ...this.tenant.scope(organizationId) },
        select: { id: true },
      }),
      this.prisma.applicationLinkSource.findMany({
        where: { id: { in: ids }, ...this.tenant.scope(organizationId) },
        select: { id: true },
      }),
    ]);
    return new Set([
      ...documents.map((d) => d.id),
      ...linkSources.map((s) => s.id),
    ]);
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
