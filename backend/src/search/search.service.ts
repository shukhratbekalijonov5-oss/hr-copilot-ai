import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { APPLICANT_APPLICATION_SCOPE } from '../common/vacancy-access/applicant-scope';
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
 * `documentId` is the CURRENT source key — a personal Document id for a file,
 * a CandidateLink id for a link — so the result card can address either kind
 * uniformly. `sourceType` tells the UI which one it is, and therefore whether
 * "page 2" or "portfolio.example.com/projects" is the right thing to show
 * underneath. `candidateId` stays the org-side applicant id (it is what
 * /candidates/:id routes on); `candidateName` is the account's CURRENT name.
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
   * Searches CURRENT applicant evidence.
   *
   * Since the snapshot removal there is nothing org-scoped to search: the
   * index holds one corpus per candidate account, and what makes reading it
   * lawful is the applicant relationship. The retrieval universe is resolved
   * server-side before anything reaches the AI service:
   *
   *   - with `vacancyId` (which must be one of the CALLER'S OWN vacancies):
   *     the applicant accounts of that vacancy;
   *   - without: the applicant accounts across ALL of the caller's own
   *     vacancies — the same creator-scoped workspace rule as every other
   *     surface, so a colleague's applicants never appear.
   *
   * The AI service receives that account list as a hard filter; an account
   * outside it is physically unreachable, whatever ids the client sends.
   */
  async searchEvidence(
    organizationId: string,
    userId: string,
    dto: EvidenceSearchDto,
  ): Promise<EvidenceSearchResponse> {
    // Resolve the authorized universe: (org candidateId -> live account).
    const universe = await this.applicantUniverse(
      organizationId,
      userId,
      dto.vacancyId,
    );
    const empty: EvidenceSearchResponse = {
      query: dto.query,
      results: [],
      reranked: false,
      totalConsidered: 0,
      durationMs: 0,
    };
    if (universe.size === 0) return empty;

    // Optional narrowing filters are verified against the universe BEFORE
    // they leave the backend, so a probing id cannot be used to test another
    // owner's (or another org's) data.
    let accountIds = [...new Set(universe.values())];
    if (dto.candidateId) {
      const accountId = universe.get(dto.candidateId);
      this.tenant.assertFound(accountId ?? null, 'Candidate');
      accountIds = [accountId!];
    }
    if (dto.documentId) {
      // A source filter may name either kind of CURRENT evidence — a personal
      // file or a professional link — because both occupy one key space in
      // the index. Either way it must belong to an account in the universe.
      const [document, link] = await Promise.all([
        this.prisma.document.findFirst({
          where: {
            id: dto.documentId,
            candidateAccountId: { in: accountIds },
            organizationId: null,
          },
          select: { id: true },
        }),
        this.prisma.candidateLink.findFirst({
          where: {
            id: dto.documentId,
            candidateAccountId: { in: accountIds },
          },
          select: { id: true },
        }),
      ]);
      this.tenant.assertFound(document ?? link, 'Document');
    }

    const limit = dto.limit ?? 10;
    let result: AiEvidenceSearchResult;
    try {
      result = await this.ai.searchEvidence(dto.query, {
        candidateAccountIds: accountIds,
        documentId: dto.documentId,
        // Ask for more than the page size. The account universe is a hard
        // pre-filter now, so the return-path checks below drop far less than
        // the old vacancy trim did — but a source deleted while its eviction
        // is still retrying is dropped there, and without headroom that would
        // silently hand back a short page.
        limit: Math.min(50, limit * 2),
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

    // Two return-path checks, both bounded to the hits actually returned:
    //
    //  - identity: a hit resolves to the LIVE person (current name) through
    //    the org-side applicant record; anything unresolvable is dropped
    //    rather than shown without context;
    //  - deletion: a hit whose source row no longer exists is dropped. The
    //    vectors may outlive the row while an eviction retries, and this
    //    makes them unusable in the meantime.
    const [people, liveSources] = await Promise.all([
      this.applicantsByAccount(organizationId, result.hits),
      this.survivingSourceIds(result.hits),
    ]);
    const hits = result.hits
      .filter((hit) => hit.documentId)
      .filter((hit) => liveSources.has(hit.documentId))
      .filter(
        (hit) =>
          hit.candidateAccountId !== null && people.has(hit.candidateAccountId),
      )
      .slice(0, limit);

    return {
      query: result.query,
      results: hits.map((hit) => {
        const person = people.get(hit.candidateAccountId!)!;
        return {
          candidateId: person.candidateId,
          candidateName: person.fullName,
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
        };
      }),
      reranked: result.reranked,
      totalConsidered: result.totalCandidatesConsidered,
      durationMs: result.durationMs,
    };
  }

  /**
   * The searchable universe as (org candidateId -> candidateAccountId), for
   * the caller's own vacancies — one of them, or all of them.
   */
  private async applicantUniverse(
    organizationId: string,
    userId: string,
    vacancyId?: string,
  ): Promise<Map<string, string>> {
    if (vacancyId) {
      await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);
    }
    const associations = await this.prisma.application.findMany({
      where: {
        ...APPLICANT_APPLICATION_SCOPE,
        vacancy: vacancyId
          ? { id: vacancyId, organizationId }
          : { organizationId, createdById: userId },
      },
      select: {
        candidate: { select: { id: true, candidateAccountId: true } },
      },
    });
    const universe = new Map<string, string>();
    for (const { candidate } of associations) {
      if (candidate.candidateAccountId) {
        universe.set(candidate.id, candidate.candidateAccountId);
      }
    }
    return universe;
  }

  /**
   * Which of these hits' sources STILL EXIST right now.
   *
   * A hit's `documentId` is the source key for either kind — a personal file
   * or a professional link — so both tables are consulted and the result is
   * one set of ids. Only the ids the index actually returned are looked up,
   * so this is a bounded query however large the corpus grows.
   *
   * This is the search-side half of the rule that deleted evidence stops
   * existing: the vectors may outlive the row for as long as an eviction is
   * retrying, and this makes them unusable in the meantime.
   */
  private async survivingSourceIds(
    hits: EvidenceSearchHit[],
  ): Promise<Set<string>> {
    const ids = [...new Set(hits.map((h) => h.documentId).filter(Boolean))];
    if (ids.length === 0) return new Set();

    const [documents, links] = await Promise.all([
      this.prisma.document.findMany({
        where: { id: { in: ids }, organizationId: null },
        select: { id: true },
      }),
      this.prisma.candidateLink.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      }),
    ]);
    return new Set([...documents.map((d) => d.id), ...links.map((l) => l.id)]);
  }

  /**
   * Resolves the LIVE person behind each hit's account: the org-side
   * applicant record (for the /candidates/:id link) plus the account's
   * CURRENT display name. Membership in the returned map is what makes a hit
   * displayable — an account with no applicant record in this organization
   * resolves to nothing and its hit is dropped.
   */
  private async applicantsByAccount(
    organizationId: string,
    hits: EvidenceSearchHit[],
  ): Promise<Map<string, { candidateId: string; fullName: string }>> {
    const accountIds = [
      ...new Set(hits.map((h) => h.candidateAccountId).filter(Boolean)),
    ] as string[];
    if (accountIds.length === 0) return new Map();

    const candidates = await this.prisma.candidate.findMany({
      where: {
        ...this.tenant.scope(organizationId),
        // Subsumes the applicant scope: an id from this list is non-null by
        // construction, and the DIRECT-application half was already enforced
        // when the universe containing it was resolved.
        candidateAccountId: { in: accountIds },
      },
      select: {
        id: true,
        fullName: true,
        candidateAccount: {
          select: { id: true, user: { select: { fullName: true } } },
        },
      },
    });
    return new Map(
      candidates
        .filter((c) => c.candidateAccount)
        .map((c) => [
          c.candidateAccount!.id,
          {
            candidateId: c.id,
            fullName: c.candidateAccount!.user.fullName ?? c.fullName,
          },
        ]),
    );
  }
}
