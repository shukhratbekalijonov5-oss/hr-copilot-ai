import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VacanciesService } from './vacancies.service';
import { TenantService } from '../common/tenant/tenant.service';
import { VacancyStatus } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function createPrismaMock() {
  return {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ slug: 'org-a-slug' }),
    },
    vacancy: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    jobRequirement: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('VacanciesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: VacanciesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new VacanciesService(
      prisma as unknown as PrismaService,
      new TenantService(),
    );
  });

  describe('create', () => {
    it('stamps the caller organization and creator onto the row', async () => {
      prisma.vacancy.create.mockResolvedValue({ id: 'v1' });

      await service.create(ORG_A, 'user-1', { title: 'Backend Engineer' });

      expect(prisma.vacancy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_A,
            createdById: 'user-1',
            title: 'Backend Engineer',
            status: VacancyStatus.DRAFT,
            // Public identifier minted once at creation: title + org slug +
            // random suffix, never regenerated on later edits.
            publicSlug: expect.stringMatching(
              /^backend-engineer-org-a-slug-[0-9a-f]{6}$/,
            ),
          }),
        }),
      );
    });

    it('retries with a fresh slug on a publicSlug collision', async () => {
      prisma.vacancy.create
        .mockRejectedValueOnce({
          code: 'P2002',
          meta: { target: ['publicSlug'] },
        })
        .mockResolvedValueOnce({ id: 'v1' });

      await service.create(ORG_A, 'user-1', { title: 'Backend Engineer' });

      expect(prisma.vacancy.create).toHaveBeenCalledTimes(2);
      const [first, second] = prisma.vacancy.create.mock.calls;
      expect(first[0].data.publicSlug).not.toBe(second[0].data.publicSlug);
    });
  });

  describe('findAll — tenant isolation', () => {
    beforeEach(() => {
      prisma.vacancy.findMany.mockResolvedValue([]);
      prisma.vacancy.count.mockResolvedValue(0);
    });

    it('always constrains the query to the caller organization', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      const where = prisma.vacancy.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
    });

    it('keeps the tenant filter even when search filters are supplied', async () => {
      await service.findAll(ORG_A, {
        page: 1,
        limit: 20,
        skip: 0,
        search: 'engineer',
        status: VacancyStatus.OPEN,
      });

      const where = prisma.vacancy.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      expect(where.status).toBe(VacancyStatus.OPEN);
    });

    it('returns pagination metadata', async () => {
      prisma.vacancy.count.mockResolvedValue(45);
      const result = await service.findAll(ORG_A, {
        page: 2,
        limit: 20,
        skip: 20,
      });

      expect(result.meta).toEqual({
        total: 45,
        page: 2,
        limit: 20,
        totalPages: 3,
      });
    });
  });

  describe('findOne — tenant isolation', () => {
    it('scopes the lookup by organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        organizationId: ORG_A,
      });

      await service.findOne(ORG_A, 'v1');

      expect(prisma.vacancy.findFirst.mock.calls[0][0].where).toEqual({
        id: 'v1',
        organizationId: ORG_A,
      });
    });

    it("404s on another organization's vacancy rather than leaking its existence", async () => {
      // The org-scoped query simply finds nothing.
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_B, 'v1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update / delete — tenant isolation', () => {
    it('refuses to update a vacancy from another organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ORG_B, 'v1', { title: 'Hijacked' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.vacancy.update).not.toHaveBeenCalled();
    });

    it('refuses to delete a vacancy from another organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG_B, 'v1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.vacancy.delete).not.toHaveBeenCalled();
    });
  });

  describe('setStatus', () => {
    it('closes an open vacancy', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        status: VacancyStatus.OPEN,
      });
      prisma.vacancy.update.mockResolvedValue({ id: 'v1' });

      await service.setStatus(ORG_A, 'v1', VacancyStatus.CLOSED);

      expect(prisma.vacancy.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { status: VacancyStatus.CLOSED },
      });
    });

    it('refuses to move an archived vacancy back into another state', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: 'v1',
        status: VacancyStatus.ARCHIVED,
      });

      await expect(
        service.setStatus(ORG_A, 'v1', VacancyStatus.OPEN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.vacancy.update).not.toHaveBeenCalled();
    });
  });

  describe('job requirements — tenancy inherited from the vacancy', () => {
    it('rejects adding a requirement to another organization vacancy', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(
        service.addRequirement(ORG_B, 'v1', { text: 'Injected requirement' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.jobRequirement.create).not.toHaveBeenCalled();
    });

    it('filters requirement updates through the parent vacancy organization', async () => {
      prisma.jobRequirement.findFirst.mockResolvedValue({ id: 'r1' });
      prisma.jobRequirement.update.mockResolvedValue({ id: 'r1' });

      await service.updateRequirement(ORG_A, 'v1', 'r1', { required: false });

      expect(prisma.jobRequirement.findFirst.mock.calls[0][0].where).toEqual({
        id: 'r1',
        vacancyId: 'v1',
        vacancy: { organizationId: ORG_A },
      });
    });
  });
});
