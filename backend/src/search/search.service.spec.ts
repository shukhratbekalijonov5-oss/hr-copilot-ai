import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SearchService } from './search.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { AiServiceDisabledError } from '../ai/ai-service.client';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
/** The org-side applicant record, and the account that owns the evidence. */
const CAND = 'cand-1';
const ACCOUNT = 'acct-1';

function aiResult(hits: unknown[] = []) {
  return {
    query: 'kubernetes',
    hits,
    totalCandidatesConsidered: hits.length,
    reranked: true,
    durationMs: 12,
  };
}

/**
 * A hit is keyed by the CANDIDATE ACCOUNT: there is one corpus per person, not
 * one per organization. The org-side candidateId is resolved on the way back,
 * because that is what the recruiter's /candidates/:id link needs.
 */
const HIT = {
  candidateAccountId: ACCOUNT,
  documentId: 'doc-1',
  fileName: 'jiwoo-han.pdf',
  section: 'experience',
  pageNumber: 2,
  chunkIndex: 3,
  text: 'Led the migration to a production Kubernetes cluster',
  retrievalScore: 0.41,
  rerankScore: 0.87,
};

/** One applicant association as the universe query reads it. */
const applicant = (id: string, accountId: string | null) => ({
  candidate: { id, candidateAccountId: accountId },
});

/** One org-side applicant record with its live account identity. */
const person = (id: string, accountId: string, fullName: string) => ({
  id,
  fullName,
  candidateAccount: { id: accountId, user: { fullName } },
});

describe('SearchService', () => {
  let ai: any;
  let prisma: any;
  let service: SearchService;

  beforeEach(() => {
    ai = { searchEvidence: jest.fn().mockResolvedValue(aiResult([HIT])) };
    prisma = {
      candidate: {
        findMany: jest
          .fn()
          .mockResolvedValue([person(CAND, ACCOUNT, 'Ji-woo Han')]),
      },
      document: {
        // The source filter resolves against the candidate's PERSONAL file.
        findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        // The surviving-source lookup: by default every returned hit's source
        // still exists, so results pass through. A test that deletes a source
        // makes this return without it.
        findMany: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
      },
      // A source filter may name a personal FILE or a professional LINK; both
      // are checked against the authorized universe before anything leaves the
      // backend.
      candidateLink: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      vacancy: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'vac-1',
          title: 'Backend Engineer',
          status: 'OPEN',
          createdById: 'hr-a',
        }),
      },
      application: {
        findMany: jest.fn().mockResolvedValue([applicant(CAND, ACCOUNT)]),
      },
    };
    service = new SearchService(
      ai,
      prisma,
      new TenantService(),
      new OwnedVacancyService(prisma),
    );
  });

  /**
   * The authorized universe replaces the old tenant filter.
   *
   * There is no org-owned copy of a candidate's evidence to search any more —
   * one corpus per candidate account, and the applicant relationship is what
   * makes reading it lawful. So the isolation guarantee moved: instead of
   * "the index is filtered by the organizationId from auth", it is "the index
   * is filtered by the account list the backend resolved from the caller's own
   * applicant relationships". Both are server-side derivations that no client
   * input can influence, and these tests hold the new one to that standard.
   */
  describe('authorized applicant universe', () => {
    it('sends the accounts resolved from the authenticated caller, and no tenant filter', async () => {
      await service.searchEvidence(ORG_A, 'hr-a', { query: 'kubernetes' });

      expect(ai.searchEvidence).toHaveBeenCalledWith(
        'kubernetes',
        expect.objectContaining({ candidateAccountIds: [ACCOUNT] }),
      );
      // Nothing org-shaped travels to the AI service: an organizationId would
      // filter nothing, because the corpus it used to select no longer exists.
      expect(ai.searchEvidence.mock.calls[0][1]).not.toHaveProperty(
        'organizationId',
      );
      expect(prisma.application.findMany.mock.calls[0][0].where).toMatchObject({
        vacancy: { organizationId: ORG_A, createdById: 'hr-a' },
      });
    });

    it('cannot be redirected by anything in the DTO', async () => {
      // The DTO has no organizationId field, and the global ValidationPipe
      // rejects unknown properties — this asserts the service itself also
      // ignores any stray value.
      await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
        organizationId: ORG_B,
        candidateAccountIds: ['acct-someone-else'],
      } as never);

      expect(prisma.application.findMany.mock.calls[0][0].where).toMatchObject({
        vacancy: { organizationId: ORG_A, createdById: 'hr-a' },
      });
      expect(ai.searchEvidence.mock.calls[0][1].candidateAccountIds).toEqual([
        ACCOUNT,
      ]);
    });

    it('an empty universe returns empty without querying the index', async () => {
      // Nobody has applied to any of my vacancies: there is nothing I am
      // authorized to retrieve, so no question is asked at all.
      prisma.application.findMany.mockResolvedValue([]);

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });

      expect(response.results).toEqual([]);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('rejects a candidate filter that is not in the universe', async () => {
      // Another organization's candidate, a colleague's applicant and a
      // fabricated id are indistinguishable here — none of them is a key of
      // the map, so all three are 404, which is what stops the filter being
      // used to probe for existence.
      await expect(
        service.searchEvidence(ORG_A, 'hr-a', {
          query: 'x',
          candidateId: 'cand-other',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('a candidate filter narrows retrieval to that ONE account', async () => {
      prisma.application.findMany.mockResolvedValue([
        applicant(CAND, ACCOUNT),
        applicant('cand-2', 'acct-2'),
      ]);

      await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
        candidateId: CAND,
      });

      expect(ai.searchEvidence.mock.calls[0][1].candidateAccountIds).toEqual([
        ACCOUNT,
      ]);
    });

    it('rejects a source filter belonging to nobody in the universe', async () => {
      prisma.document.findFirst.mockResolvedValue(null);
      prisma.candidateLink.findFirst.mockResolvedValue(null);

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', {
          query: 'x',
          documentId: 'doc-other',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('checks a source filter against the universe accounts and personal rows only', async () => {
      await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
        documentId: 'doc-1',
      });

      // `organizationId: null` is the whole point: the row must be the
      // candidate's own file, the only copy that exists.
      expect(prisma.document.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'doc-1',
        candidateAccountId: { in: [ACCOUNT] },
        organizationId: null,
      });
    });

    it('accepts a filter naming a professional LINK, not just a file', async () => {
      // Files and links share one key space in the index, so the filter has to
      // resolve against either — still inside the authorized universe.
      prisma.document.findFirst.mockResolvedValue(null);
      prisma.candidateLink.findFirst.mockResolvedValue({ id: 'link-1' });

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', {
          query: 'kubernetes',
          documentId: 'link-1',
        }),
      ).resolves.toBeDefined();
      expect(
        prisma.candidateLink.findFirst.mock.calls[0][0].where
          .candidateAccountId,
      ).toEqual({ in: [ACCOUNT] });
    });

    it('resolves candidate names scoped to the organization', async () => {
      await service.searchEvidence(ORG_A, 'hr-a', { query: 'kubernetes' });

      expect(
        prisma.candidate.findMany.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });
  });

  describe('results', () => {
    it('preserves provenance for citation', async () => {
      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });
      const result = response.results[0];

      expect(result.documentId).toBe('doc-1');
      expect(result.fileName).toBe('jiwoo-han.pdf');
      expect(result.pageNumber).toBe(2);
      expect(result.section).toBe('experience');
      expect(result.text).toContain('Kubernetes');
    });

    it('enriches hits with the candidate name', async () => {
      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });
      expect(response.results[0].candidateName).toBe('Ji-woo Han');
    });

    it('emits the ORG-side candidate id and the account’s CURRENT name', async () => {
      // The account id is an internal retrieval key and never leaves the
      // backend; the recruiter needs the id their /candidates/:id route uses.
      // The name comes from the live account, so a candidate who has since
      // corrected their name is shown correctly rather than as the string
      // captured when they applied.
      prisma.candidate.findMany.mockResolvedValue([
        {
          id: CAND,
          fullName: 'Jiwoo Han (typo)',
          candidateAccount: { id: ACCOUNT, user: { fullName: 'Ji-woo Han' } },
        },
      ]);

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });

      expect(response.results[0].candidateId).toBe(CAND);
      expect(response.results[0].candidateName).toBe('Ji-woo Han');
      expect(response.results[0]).not.toHaveProperty('candidateAccountId');
    });

    it('keeps relevance scores under a name that is not a candidate rating', async () => {
      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });
      const result = response.results[0];

      expect(result.relevance.retrievalScore).toBe(0.41);
      expect(result.relevance.rerankScore).toBe(0.87);
      // The API must not present anything as a candidate/hiring score.
      expect(result).not.toHaveProperty('score');
      expect(result).not.toHaveProperty('candidateScore');
      expect(result).not.toHaveProperty('rating');
    });

    it('returns an empty result set when no evidence is found', async () => {
      ai.searchEvidence.mockResolvedValue(aiResult([]));

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'AWS',
      });

      expect(response.results).toEqual([]);
      expect(response.totalConsidered).toBe(0);
    });

    it('drops a hit whose source row has been deleted', async () => {
      // Vectors can outlive their row while an eviction retries. Until it
      // completes they are inert: a passage from a withdrawn file is not
      // shown, even though the index still returned it.
      prisma.document.findMany.mockResolvedValue([]);
      prisma.candidateLink.findMany.mockResolvedValue([]);

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });

      expect(response.results).toEqual([]);
      expect(prisma.document.findMany.mock.calls[0][0].where).toMatchObject({
        id: { in: ['doc-1'] },
        organizationId: null,
      });
    });
  });

  describe('AI service availability', () => {
    it('reports a clear 503 when the AI service is not configured', async () => {
      ai.searchEvidence.mockRejectedValue(
        new AiServiceDisabledError('search evidence'),
      );

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', { query: 'kubernetes' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('does not invent results when the AI service is down', async () => {
      ai.searchEvidence.mockRejectedValue(new Error('connection refused'));

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', { query: 'kubernetes' }),
      ).rejects.toThrow('connection refused');
    });
  });

  describe('selected-vacancy scoping', () => {
    it('an owned vacancyId restricts retrieval to that vacancy applicants', async () => {
      ai.searchEvidence.mockResolvedValue(
        aiResult([
          HIT,
          { ...HIT, candidateAccountId: 'acct-other', documentId: 'doc-2' },
        ]),
      );
      prisma.document.findMany.mockResolvedValue([
        { id: 'doc-1' },
        { id: 'doc-2' },
      ]);

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
        vacancyId: 'vac-1',
      });

      // Only ACCOUNT applied to vac-1 (application.findMany mock), so it is
      // the only account the index is allowed to search — the restriction is a
      // pre-filter now, not a post-hoc trim of somebody else's results.
      expect(ai.searchEvidence.mock.calls[0][1].candidateAccountIds).toEqual([
        ACCOUNT,
      ]);
      // A hit for an account outside the universe is still dropped on the way
      // back: belt and braces, since a stale vector must never be attributed.
      expect(response.results).toHaveLength(1);
      expect(response.results[0].candidateId).toBe(CAND);
    });

    it("a same-org colleague's vacancy is refused with VACANCY_NOT_OWNED", async () => {
      await expect(
        service.searchEvidence(ORG_A, 'hr-b', {
          query: 'kubernetes',
          vacancyId: 'vac-1',
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('a vacancy with no applicants returns empty without querying the index', async () => {
      prisma.application.findMany.mockResolvedValue([]);

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
        vacancyId: 'vac-1',
      });

      expect(response.results).toEqual([]);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('the vacancy association set counts real APPLICATIONS only', async () => {
      await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
        vacancyId: 'vac-1',
      });

      expect(prisma.application.findMany.mock.calls[0][0].where).toMatchObject({
        source: 'DIRECT',
        candidate: { candidateAccountId: { not: null } },
        vacancy: { id: 'vac-1', organizationId: ORG_A },
      });
    });

    it('without a vacancy the universe is still creator-scoped', async () => {
      // The same workspace rule as every other surface: my own vacancies'
      // applicants, never a colleague's.
      await service.searchEvidence(ORG_A, 'hr-a', { query: 'kubernetes' });

      expect(prisma.application.findMany.mock.calls[0][0].where).toMatchObject({
        source: 'DIRECT',
        vacancy: { organizationId: ORG_A, createdById: 'hr-a' },
      });
    });
  });

  describe('no orphaned talent database', () => {
    it('drops hits whose account has no applicant record in this organization', async () => {
      // A vector left behind by the removed recruiter-upload feature, or one
      // belonging to a person who never applied here: the chunk is still in
      // the index, but nothing in this organization authorises showing it.
      prisma.candidate.findMany.mockResolvedValue([]);

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });

      expect(response.results).toEqual([]);
      expect(prisma.candidate.findMany.mock.calls[0][0].where).toMatchObject({
        organizationId: ORG_A,
        candidateAccountId: { in: [ACCOUNT] },
      });
    });

    it('drops a hit that carries no account at all', async () => {
      ai.searchEvidence.mockResolvedValue(
        aiResult([{ ...HIT, candidateAccountId: null }]),
      );

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });

      expect(response.results).toEqual([]);
    });

    it('an explicit candidate filter must also name an applicant', async () => {
      // The universe is built from DIRECT applications by account-backed
      // candidates, so a historical recruiter-created record is not a key of
      // it and cannot be searched, whoever asks.
      prisma.application.findMany.mockResolvedValue([applicant(CAND, ACCOUNT)]);

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', {
          query: 'kubernetes',
          candidateId: 'cand-manual',
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('an applicant with no account row never enters the universe', async () => {
      prisma.application.findMany.mockResolvedValue([
        applicant('cand-manual', null),
      ]);

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });

      expect(response.results).toEqual([]);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });
  });
});
