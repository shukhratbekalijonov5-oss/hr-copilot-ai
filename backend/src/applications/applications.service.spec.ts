import { ConflictException, NotFoundException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { TenantService } from '../common/tenant/tenant.service';
import { ApplicationStatus } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function createPrismaMock() {
  return {
    application: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    vacancy: { findFirst: jest.fn() },
    candidate: { findFirst: jest.fn() },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('ApplicationsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: ApplicationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ApplicationsService(
      prisma as unknown as PrismaService,
      new TenantService(),
    );
  });

  const dto = { vacancyId: 'v1', candidateId: 'c1' };

  describe('create — both parents must be in the caller organization', () => {
    it('links a candidate to a vacancy when both belong to the caller', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.candidate.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.application.findUnique.mockResolvedValue(null);
      prisma.application.create.mockResolvedValue({ id: 'a1' });

      await service.create(ORG_A, dto);

      expect(prisma.application.create.mock.calls[0][0].data).toEqual({
        vacancyId: 'v1',
        candidateId: 'c1',
        status: ApplicationStatus.NEW,
      });
    });

    it("rejects attaching one org's candidate to another org's vacancy", async () => {
      // The vacancy resolves under the caller org, the candidate does not.
      prisma.vacancy.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.create(ORG_A, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.application.create).not.toHaveBeenCalled();
    });

    it('rejects a vacancy from another organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);
      prisma.candidate.findFirst.mockResolvedValue({ id: 'c1' });

      await expect(service.create(ORG_B, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.application.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate candidate/vacancy pairing', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.candidate.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.application.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(ORG_A, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('findAll — tenancy through both relations', () => {
    it('filters on the vacancy and the candidate organization', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);

      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      const where = prisma.application.findMany.mock.calls[0][0].where;
      expect(where.vacancy).toEqual({ organizationId: ORG_A });
      expect(where.candidate).toEqual({ organizationId: ORG_A });
    });
  });

  describe('updateStatus — human-controlled stage changes', () => {
    it('applies the requested status', async () => {
      prisma.application.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.application.update.mockResolvedValue({ id: 'a1' });

      await service.updateStatus(ORG_A, 'a1', ApplicationStatus.INTERVIEW);

      expect(prisma.application.update.mock.calls[0][0].data).toEqual({
        status: ApplicationStatus.INTERVIEW,
      });
    });

    it('allows a human to reverse a decision', async () => {
      prisma.application.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.application.update.mockResolvedValue({ id: 'a1' });

      await service.updateStatus(ORG_A, 'a1', ApplicationStatus.REVIEWING);

      expect(prisma.application.update).toHaveBeenCalled();
    });

    it('refuses to change an application in another organization', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStatus(ORG_B, 'a1', ApplicationStatus.HIRED),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.application.update).not.toHaveBeenCalled();
    });
  });
});
