import { NotFoundException } from '@nestjs/common';
import { CandidatesService } from './candidates.service';
import { TenantService } from '../common/tenant/tenant.service';
import type { PrismaService } from '../prisma/prisma.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function createPrismaMock() {
  const mock = {
    candidate: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(
    (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof arg === 'function' ? arg(mock) : Promise.all(arg),
  );
  return mock;
}

describe('CandidatesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: CandidatesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new CandidatesService(
      prisma as unknown as PrismaService,
      new TenantService(),
    );
  });

  it('exposes no way to create a candidate', () => {
    // HR-side candidate creation was removed from the product: a Candidate
    // row exists only because a person applied.
    expect(
      (service as unknown as Record<string, unknown>).create,
    ).toBeUndefined();
  });

  describe('findAll — tenant isolation', () => {
    beforeEach(() => {
      prisma.candidate.findMany.mockResolvedValue([]);
      prisma.candidate.count.mockResolvedValue(0);
    });

    it('constrains every list query to the caller organization', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      expect(
        prisma.candidate.findMany.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });

    it('lists APPLICANTS only — never a leftover recruiter-created record', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      expect(
        prisma.candidate.findMany.mock.calls[0][0].where.candidateAccountId,
      ).toEqual({ not: null });
    });

    it('keeps the tenant filter alongside a metadata search', async () => {
      await service.findAll(ORG_A, {
        page: 1,
        limit: 20,
        skip: 0,
        search: 'engineer',
        minExperienceYears: 5,
      });

      const where = prisma.candidate.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      expect(where.totalExperienceYears).toEqual({ gte: 5 });
      expect(where.OR).toHaveLength(3);
    });

    it('applies pagination offsets', async () => {
      await service.findAll(ORG_A, { page: 3, limit: 10, skip: 20 });

      const args = prisma.candidate.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });
  });

  describe('findOne / update / remove — tenant isolation', () => {
    it('404s for a candidate belonging to another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_B, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('will not update across tenants', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ORG_B, 'c1', { fullName: 'Overwritten' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.candidate.update).not.toHaveBeenCalled();
    });

    it('will not delete across tenants', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG_B, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.candidate.delete).not.toHaveBeenCalled();
    });

    it('reads/edits are applicant-scoped, not merely tenant-scoped', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_A, 'c-manual')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.candidate.findFirst.mock.calls[0][0].where).toMatchObject({
        organizationId: ORG_A,
        candidateAccountId: { not: null },
      });
    });

    it('permits access within the owning organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue({
        id: 'c1',
        organizationId: ORG_A,
      });
      prisma.candidate.update.mockResolvedValue({ id: 'c1' });

      await expect(
        service.update(ORG_A, 'c1', { location: 'Tashkent, UZ' }),
      ).resolves.toEqual({ id: 'c1' });
    });
  });
});
