import { NotFoundException } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { TenantService } from '../common/tenant/tenant.service';
import { QueryEvidenceDto } from './dto/query-evidence.dto';
import { EvidenceType } from '../generated/prisma/enums';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function baseQuery(): QueryEvidenceDto {
  return Object.assign(new QueryEvidenceDto(), { page: 1, limit: 20 });
}

describe('EvidenceService', () => {
  let prisma: any;
  let service: EvidenceService;

  beforeEach(() => {
    prisma = {
      candidateEvidence: {
        create: jest.fn().mockResolvedValue({ id: 'e1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      candidate: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
      document: { findFirst: jest.fn().mockResolvedValue({ id: 'd1' }) },
      vacancy: { findFirst: jest.fn().mockResolvedValue({ id: 'v1' }) },
      jobRequirement: { findFirst: jest.fn().mockResolvedValue({ id: 'r1' }) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new EvidenceService(prisma, new TenantService());
  });

  const dto = {
    candidateId: 'c1',
    documentId: 'd1',
    text: 'Led a team of six.',
  };

  describe('create — every reference is re-checked against the caller org', () => {
    it('stamps the caller organization onto the evidence row', async () => {
      await service.create(ORG_A, dto);

      expect(
        prisma.candidateEvidence.create.mock.calls[0][0].data.organizationId,
      ).toBe(ORG_A);
    });

    it('stores no score or confidence field', async () => {
      await service.create(ORG_A, dto);

      const data = prisma.candidateEvidence.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('score');
      expect(data).not.toHaveProperty('confidence');
      expect(data).not.toHaveProperty('rating');
    });

    it('rejects a candidate from another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.create(ORG_A, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.candidateEvidence.create).not.toHaveBeenCalled();
    });

    it('rejects a document from another organization', async () => {
      prisma.document.findFirst.mockResolvedValue(null);

      await expect(service.create(ORG_A, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a requirement whose vacancy belongs to another organization', async () => {
      prisma.jobRequirement.findFirst.mockResolvedValue(null);

      await expect(
        service.create(ORG_A, { ...dto, requirementId: 'r-foreign' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('defaults the evidence type to OTHER', async () => {
      await service.create(ORG_A, dto);

      expect(
        prisma.candidateEvidence.create.mock.calls[0][0].data.evidenceType,
      ).toBe(EvidenceType.OTHER);
    });
  });

  describe('reads — tenant isolation', () => {
    it('scopes every listing to the caller organization', async () => {
      await service.findAll(ORG_A, baseQuery());

      expect(
        prisma.candidateEvidence.findMany.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });

    it('keeps pagination working when narrowing by candidate', async () => {
      // Guards the DTO-copy helper: a plain spread would drop the `skip` getter.
      await service.findByCandidate(ORG_A, 'c1', baseQuery());

      const args = prisma.candidateEvidence.findMany.mock.calls[0][0];
      expect(args.where.candidateId).toBe('c1');
      expect(args.where.organizationId).toBe(ORG_A);
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
    });

    it('returns document and page metadata for verification', async () => {
      await service.findAll(ORG_A, baseQuery());

      const include =
        prisma.candidateEvidence.findMany.mock.calls[0][0].include;
      expect(include.document.select).toEqual(
        expect.objectContaining({ originalFileName: true, pageCount: true }),
      );
    });

    it("refuses to list evidence for another organization's requirement", async () => {
      prisma.jobRequirement.findFirst.mockResolvedValue(null);

      await expect(
        service.findByRequirement(ORG_B, 'r1', baseQuery()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s on a single evidence row from another organization', async () => {
      prisma.candidateEvidence.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_B, 'e1')).rejects.toThrow(
        'Evidence not found',
      );
    });
  });
});
