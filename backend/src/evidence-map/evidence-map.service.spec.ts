import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EvidenceMapService } from './evidence-map.service';
import { TenantService } from '../common/tenant/tenant.service';
import { AiServiceDisabledError } from '../ai/ai-service.client';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const CAND = 'cand-1';
const VAC = 'vac-1';

const REQUIREMENTS = [
  { id: 'r-nest', text: 'NestJS', type: 'SKILL', required: true },
  {
    id: 'r-aws',
    text: 'AWS production experience',
    type: 'SKILL',
    required: true,
  },
];

function aiMapping() {
  return {
    candidateId: CAND,
    vacancyId: VAC,
    durationMs: 10,
    requirements: [
      {
        requirementId: 'r-nest',
        requirementText: 'NestJS',
        status: 'EVIDENCE_FOUND' as const,
        matchedTerms: ['nestjs'],
        missingTerms: [],
        reason: 'Retrieved evidence mentions nestjs.',
        evidence: [
          {
            chunkId: 'chunk-1',
            documentId: 'doc-1',
            fileName: 'cv.pdf',
            pageNumber: 1,
            section: 'experience',
            text: 'Built the platform using NestJS',
          },
        ],
      },
      {
        requirementId: 'r-aws',
        requirementText: 'AWS production experience',
        status: 'NO_EVIDENCE_FOUND' as const,
        matchedTerms: [],
        missingTerms: ['aws'],
        reason: 'No retrieved passage mentions aws.',
        evidence: [],
      },
    ],
  };
}

describe('EvidenceMapService', () => {
  let prisma: any;
  let ai: any;
  let service: EvidenceMapService;
  let createMany: jest.Mock;
  let deleteMany: jest.Mock;
  let upsert: jest.Mock;

  beforeEach(() => {
    createMany = jest.fn();
    deleteMany = jest.fn();
    upsert = jest.fn(({ create }: any) =>
      Promise.resolve({ id: `map-${create?.requirementId ?? 'x'}` }),
    );

    prisma = {
      candidate: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: CAND, fullName: 'Ji-woo Han' }),
      },
      vacancy: {
        findFirst: jest.fn().mockResolvedValue({
          id: VAC,
          title: 'Backend Engineer',
          requirements: REQUIREMENTS,
        }),
      },
      document: { findMany: jest.fn().mockResolvedValue([{ id: 'doc-1' }]) },
      requirementEvidenceMap: {
        upsert,
        findMany: jest.fn().mockResolvedValue([]),
      },
      candidateEvidence: { deleteMany, createMany },
      $transaction: jest.fn((fn: any) =>
        fn({
          requirementEvidenceMap: { upsert },
          candidateEvidence: { deleteMany, createMany },
          document: {
            findMany: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
          },
        }),
      ),
    };
    ai = { mapEvidence: jest.fn().mockResolvedValue(aiMapping()) };
    service = new EvidenceMapService(prisma, new TenantService(), ai);
  });

  describe('tenant isolation', () => {
    it('sends the organization derived from auth', async () => {
      await service.run(ORG_A, CAND, VAC);

      expect(ai.mapEvidence.mock.calls[0][0].organizationId).toBe(ORG_A);
    });

    it('rejects a candidate from another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.run(ORG_B, CAND, VAC)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('rejects a vacancy from another organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.run(ORG_B, CAND, VAC)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('scopes both lookups by organization', async () => {
      await service.run(ORG_A, CAND, VAC);

      expect(
        prisma.candidate.findFirst.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
      expect(
        prisma.vacancy.findFirst.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });
  });

  describe('persistence policy', () => {
    it('stores a mapping row per requirement, including one with no evidence', async () => {
      await service.run(ORG_A, CAND, VAC);

      expect(upsert).toHaveBeenCalledTimes(2);
      const statuses = upsert.mock.calls.map((c) => c[0].create.status);
      expect(statuses).toEqual(['EVIDENCE_FOUND', 'NO_EVIDENCE_FOUND']);
    });

    it('stores evidence rows only for requirements that have evidence', async () => {
      await service.run(ORG_A, CAND, VAC);

      expect(createMany).toHaveBeenCalledTimes(1);
      const rows = createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(1);
      expect(rows[0].requirementId).toBe('r-nest');
    });

    it('preserves the source chunk id for traceability', async () => {
      await service.run(ORG_A, CAND, VAC);

      expect(createMany.mock.calls[0][0].data[0].sourceChunkId).toBe('chunk-1');
    });

    it('stamps the caller organization onto stored evidence', async () => {
      await service.run(ORG_A, CAND, VAC);

      expect(createMany.mock.calls[0][0].data[0].organizationId).toBe(ORG_A);
    });

    it('skips evidence whose document no longer exists in this organization', async () => {
      prisma.$transaction = jest.fn((fn: any) =>
        fn({
          requirementEvidenceMap: { upsert },
          candidateEvidence: { deleteMany, createMany },
          document: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );

      await service.run(ORG_A, CAND, VAC);

      expect(createMany.mock.calls[0][0].data).toHaveLength(0);
    });
  });

  describe('idempotency', () => {
    it('deletes prior evidence before inserting the new set', async () => {
      await service.run(ORG_A, CAND, VAC);

      expect(deleteMany).toHaveBeenCalledWith({
        where: { requirementMapId: 'map-r-nest' },
      });
    });

    it('upserts on the candidate/vacancy/requirement key', async () => {
      await service.run(ORG_A, CAND, VAC);

      expect(upsert.mock.calls[0][0].where).toEqual({
        candidateId_vacancyId_requirementId: {
          candidateId: CAND,
          vacancyId: VAC,
          requirementId: 'r-nest',
        },
      });
    });

    it('re-running produces the same number of writes', async () => {
      await service.run(ORG_A, CAND, VAC);
      const first = {
        upserts: upsert.mock.calls.length,
        inserts: createMany.mock.calls.length,
      };

      upsert.mockClear();
      createMany.mockClear();
      deleteMany.mockClear();
      await service.run(ORG_A, CAND, VAC);

      expect(upsert.mock.calls.length).toBe(first.upserts);
      expect(createMany.mock.calls.length).toBe(first.inserts);
    });
  });

  describe('failure behaviour', () => {
    it('reports a clear 503 when the AI service is not configured', async () => {
      ai.mapEvidence.mockRejectedValue(
        new AiServiceDisabledError('map requirement evidence'),
      );

      await expect(service.run(ORG_A, CAND, VAC)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('refuses to map a vacancy with no requirements', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: VAC,
        title: 'Empty',
        requirements: [],
      });

      await expect(service.run(ORG_A, CAND, VAC)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('never persists anything when the AI call fails', async () => {
      ai.mapEvidence.mockRejectedValue(new Error('ai down'));

      await expect(service.run(ORG_A, CAND, VAC)).rejects.toThrow('ai down');
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe('read', () => {
    it('lists every requirement, mapped or not', async () => {
      prisma.requirementEvidenceMap.findMany.mockResolvedValue([]);

      const result = await service.read(ORG_A, CAND, VAC);

      expect(result.requirements).toHaveLength(2);
      expect(result.requirements[0].status).toBeNull();
    });

    it('scopes the read by organization', async () => {
      await service.read(ORG_A, CAND, VAC);

      expect(
        prisma.requirementEvidenceMap.findMany.mock.calls[0][0].where
          .organizationId,
      ).toBe(ORG_A);
    });

    it('never returns a score or fit percentage', async () => {
      prisma.requirementEvidenceMap.findMany.mockResolvedValue([
        {
          requirementId: 'r-nest',
          status: 'EVIDENCE_FOUND',
          reason: 'x',
          matchedTerms: ['nestjs'],
          missingTerms: [],
          updatedAt: new Date(),
          evidence: [],
        },
      ]);

      const result = await service.read(ORG_A, CAND, VAC);
      const serialised = JSON.stringify(result).toLowerCase();

      expect(serialised).not.toContain('"score"');
      expect(serialised).not.toContain('fitpercentage');
      expect(serialised).not.toContain('"rating"');
    });
  });
});
