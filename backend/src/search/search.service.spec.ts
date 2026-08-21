import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SearchService } from './search.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { AiServiceDisabledError } from '../ai/ai-service.client';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function aiResult(hits: unknown[] = []) {
  return {
    query: 'kubernetes',
    hits,
    totalCandidatesConsidered: hits.length,
    reranked: true,
    durationMs: 12,
  };
}

const HIT = {
  candidateId: 'cand-1',
  documentId: 'doc-1',
  fileName: 'jiwoo-han.pdf',
  section: 'experience',
  pageNumber: 2,
  chunkIndex: 3,
  text: 'Led the migration to a production Kubernetes cluster',
  retrievalScore: 0.41,
  rerankScore: 0.87,
};

describe('SearchService', () => {
  let ai: any;
  let prisma: any;
  let service: SearchService;

  beforeEach(() => {
    ai = { searchEvidence: jest.fn().mockResolvedValue(aiResult([HIT])) };
    prisma = {
      candidate: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cand-1' }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'cand-1', fullName: 'Ji-woo Han' }]),
      },
      document: {
        findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        // The surviving-source lookup: by default every returned hit's source
        // still exists, so results pass through. A test that deletes a source
        // makes this return without it.
        findMany: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
      },
      // A source filter may name a submitted FILE or a submitted LINK; both
      // are checked against the tenant before anything leaves the backend.
      applicationLinkSource: {
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
        findMany: jest.fn().mockResolvedValue([{ candidateId: 'cand-1' }]),
      },
    };
    service = new SearchService(
      ai,
      prisma,
      new TenantService(),
      new OwnedVacancyService(prisma),
    );
  });

  describe('tenant identity', () => {
    it('sends the organizationId derived from the authenticated user', async () => {
      await service.searchEvidence(ORG_A, 'hr-a', { query: 'kubernetes' });

      expect(ai.searchEvidence).toHaveBeenCalledWith(
        'kubernetes',
        expect.objectContaining({ organizationId: ORG_A }),
      );
    });

    it('cannot be redirected by anything in the DTO', async () => {
      // The DTO has no organizationId field, and the global ValidationPipe
      // rejects unknown properties — this asserts the service itself also
      // ignores any stray value.
      await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
        organizationId: ORG_B,
      } as never);

      expect(ai.searchEvidence.mock.calls[0][1].organizationId).toBe(ORG_A);
    });

    it('rejects a candidate filter from another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', {
          query: 'x',
          candidateId: 'cand-other',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('rejects a source filter from another organization', async () => {
      prisma.document.findFirst.mockResolvedValue(null);
      prisma.applicationLinkSource.findFirst.mockResolvedValue(null);

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', {
          query: 'x',
          documentId: 'doc-other',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('accepts a filter naming a submitted LINK, not just a file', async () => {
      // Files and link snapshots share one key space in the index, so the
      // filter has to resolve against either — scoped to this tenant.
      prisma.document.findFirst.mockResolvedValue(null);
      prisma.applicationLinkSource.findFirst.mockResolvedValue({
        id: 'link-src-1',
      });

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', {
          query: 'kubernetes',
          documentId: 'link-src-1',
        }),
      ).resolves.toBeDefined();
      expect(
        prisma.applicationLinkSource.findFirst.mock.calls[0][0].where
          .organizationId,
      ).toBe(ORG_A);
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
    it('an owned vacancyId restricts hits to that vacancy candidates', async () => {
      ai.searchEvidence.mockResolvedValue(
        aiResult([
          HIT,
          { ...HIT, candidateId: 'cand-other', documentId: 'doc-2' },
        ]),
      );

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
        vacancyId: 'vac-1',
      });

      // Only cand-1 is associated with vac-1 (application.findMany mock).
      expect(response.results).toHaveLength(1);
      expect(response.results[0].candidateId).toBe('cand-1');
      // Over-fetch so the trimmed page can still fill the requested limit.
      expect(ai.searchEvidence.mock.calls[0][1].limit).toBeGreaterThan(10);
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
        vacancyId: 'vac-1',
        source: 'DIRECT',
        candidate: { candidateAccountId: { not: null } },
      });
    });
  });

  describe('no orphaned talent database', () => {
    it('drops hits whose candidate is not an applicant of this organization', async () => {
      // A vector left behind by the removed recruiter-upload feature: the
      // chunk is still in the index, but its candidate is not an applicant.
      prisma.candidate.findMany.mockResolvedValue([]);

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });

      expect(response.results).toEqual([]);
      expect(prisma.candidate.findMany.mock.calls[0][0].where).toMatchObject({
        organizationId: ORG_A,
        candidateAccountId: { not: null },
      });
    });

    it('drops a hit that carries no candidate at all', async () => {
      ai.searchEvidence.mockResolvedValue(
        aiResult([{ ...HIT, candidateId: null }]),
      );

      const response = await service.searchEvidence(ORG_A, 'hr-a', {
        query: 'kubernetes',
      });

      expect(response.results).toEqual([]);
    });

    it('an explicit candidate filter must also name an applicant', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.searchEvidence(ORG_A, 'hr-a', {
          query: 'kubernetes',
          candidateId: 'cand-manual',
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });
  });
});
