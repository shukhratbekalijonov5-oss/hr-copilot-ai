import { NotFoundException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { TenantService } from '../common/tenant/tenant.service';

const ORG_A = 'org-a';

function createPrismaMock() {
  return {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ id: ORG_A, name: 'Northwind' }),
      update: jest.fn().mockResolvedValue({ id: ORG_A, name: 'Renamed' }),
    },
    user: { count: jest.fn().mockResolvedValue(0) },
    vacancy: { count: jest.fn().mockResolvedValue(0) },
    candidate: { count: jest.fn().mockResolvedValue(0) },
    application: { count: jest.fn().mockResolvedValue(0) },
    document: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('OrganizationsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: OrganizationsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new OrganizationsService(prisma as never, new TenantService());
  });

  describe('findCurrent', () => {
    it('reads the organization named by the token, not by client input', async () => {
      await service.findCurrent(ORG_A);

      expect(prisma.organization.findUnique.mock.calls[0][0].where).toEqual({
        id: ORG_A,
      });
    });

    it('404s when the organization no longer exists', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.findCurrent(ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateCurrent', () => {
    it('updates only the caller organization', async () => {
      await service.updateCurrent(ORG_A, { name: 'Renamed' });

      expect(prisma.organization.update.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          where: { id: ORG_A },
          data: { name: 'Renamed' },
        }),
      );
    });

    it('refuses to update a stale/unknown organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCurrent(ORG_A, { name: 'Renamed' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('does not expose slug as editable', async () => {
      await service.updateCurrent(ORG_A, { name: 'Renamed' });

      expect(
        prisma.organization.update.mock.calls[0][0].data,
      ).not.toHaveProperty('slug');
    });
  });

  describe('stats', () => {
    it('scopes every counter to the caller organization', async () => {
      await service.stats(ORG_A);

      expect(prisma.user.count.mock.calls[0][0].where).toEqual({
        organizationId: ORG_A,
      });
      expect(prisma.candidate.count.mock.calls[0][0].where).toEqual({
        organizationId: ORG_A,
      });
      // Applications inherit tenancy through both relations.
      expect(prisma.application.count.mock.calls[0][0].where).toEqual({
        vacancy: { organizationId: ORG_A },
        candidate: { organizationId: ORG_A },
      });
    });

    it('returns the full counter set', async () => {
      await expect(service.stats(ORG_A)).resolves.toEqual({
        users: 0,
        vacancies: 0,
        openVacancies: 0,
        candidates: 0,
        applications: 0,
        documents: 0,
      });
    });
  });
});
