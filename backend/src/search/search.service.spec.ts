import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { SearchService } from './search.service';
import { TenantService } from '../common/tenant/tenant.service';
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
      document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    };
    service = new SearchService(ai, prisma, new TenantService());
  });

  describe('tenant identity', () => {
    it('sends the organizationId derived from the authenticated user', async () => {
      await service.searchEvidence(ORG_A, { query: 'kubernetes' });

      expect(ai.searchEvidence).toHaveBeenCalledWith(
        'kubernetes',
        expect.objectContaining({ organizationId: ORG_A }),
      );
    });

    it('cannot be redirected by anything in the DTO', async () => {
      // The DTO has no organizationId field, and the global ValidationPipe
      // rejects unknown properties — this asserts the service itself also
      // ignores any stray value.
      await service.searchEvidence(ORG_A, {
        query: 'kubernetes',
        organizationId: ORG_B,
      } as never);

      expect(ai.searchEvidence.mock.calls[0][1].organizationId).toBe(ORG_A);
    });

    it('rejects a candidate filter from another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.searchEvidence(ORG_A, {
          query: 'x',
          candidateId: 'cand-other',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('rejects a document filter from another organization', async () => {
      prisma.document.findFirst.mockResolvedValue(null);

      await expect(
        service.searchEvidence(ORG_A, { query: 'x', documentId: 'doc-other' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.searchEvidence).not.toHaveBeenCalled();
    });

    it('resolves candidate names scoped to the organization', async () => {
      await service.searchEvidence(ORG_A, { query: 'kubernetes' });

      expect(
        prisma.candidate.findMany.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });
  });

  describe('results', () => {
    it('preserves provenance for citation', async () => {
      const response = await service.searchEvidence(ORG_A, {
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
      const response = await service.searchEvidence(ORG_A, {
        query: 'kubernetes',
      });
      expect(response.results[0].candidateName).toBe('Ji-woo Han');
    });

    it('keeps relevance scores under a name that is not a candidate rating', async () => {
      const response = await service.searchEvidence(ORG_A, {
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

      const response = await service.searchEvidence(ORG_A, { query: 'AWS' });

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
        service.searchEvidence(ORG_A, { query: 'kubernetes' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('does not invent results when the AI service is down', async () => {
      ai.searchEvidence.mockRejectedValue(new Error('connection refused'));

      await expect(
        service.searchEvidence(ORG_A, { query: 'kubernetes' }),
      ).rejects.toThrow('connection refused');
    });
  });
});
