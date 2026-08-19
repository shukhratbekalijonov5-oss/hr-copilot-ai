import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { TenantService } from '../common/tenant/tenant.service';
import { Role } from '../generated/prisma/enums';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const ACTOR = 'actor-1';

function createPrismaMock() {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ id: 'u1' }),
      delete: jest.fn().mockResolvedValue({ id: 'u1' }),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

describe('UsersService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: UsersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new UsersService(prisma as never, new TenantService());
  });

  describe('findAll — tenant isolation', () => {
    it('lists only users in the caller organization', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      expect(prisma.user.findMany.mock.calls[0][0].where.organizationId).toBe(
        ORG_A,
      );
    });

    it('keeps the tenant filter alongside a search', async () => {
      await service.findAll(ORG_A, {
        page: 1,
        limit: 20,
        skip: 0,
        search: 'dana',
        role: Role.OWNER,
      });

      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      expect(where.role).toBe(Role.OWNER);
      expect(where.OR).toHaveLength(2);
    });

    it('never selects passwordHash', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      const select = prisma.user.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('passwordHash');
      expect(select.email).toBe(true);
    });
  });

  describe('findOne', () => {
    it('404s for a user in another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.findOne(ORG_B, 'u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('never selects passwordHash', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

      await service.findOne(ORG_A, 'u1');

      expect(prisma.user.findFirst.mock.calls[0][0].select).not.toHaveProperty(
        'passwordHash',
      );
    });
  });

  describe('update', () => {
    it('updates a teammate name', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'u2',
        role: Role.RECRUITER,
      });

      await service.update(ORG_A, ACTOR, 'u2', { fullName: 'New Name' });

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        fullName: 'New Name',
      });
    });

    it('refuses to update a user in another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ORG_B, ACTOR, 'u2', { role: Role.OWNER }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('blocks self-promotion', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: ACTOR,
        role: Role.RECRUITER,
      });

      await expect(
        service.update(ORG_A, ACTOR, ACTOR, { role: Role.OWNER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows a user to rename themselves', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: ACTOR,
        role: Role.RECRUITER,
      });

      await service.update(ORG_A, ACTOR, ACTOR, { fullName: 'Renamed' });

      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('refuses to demote the last OWNER', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: Role.OWNER });
      prisma.user.count.mockResolvedValue(0); // no other owners

      await expect(
        service.update(ORG_A, ACTOR, 'u2', { role: Role.RECRUITER }),
      ).rejects.toThrow('must keep at least one OWNER');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows demoting an OWNER when another OWNER remains', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: Role.OWNER });
      prisma.user.count.mockResolvedValue(1);

      await service.update(ORG_A, ACTOR, 'u2', { role: Role.RECRUITER });

      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('counts remaining owners within the caller organization only', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: Role.OWNER });
      prisma.user.count.mockResolvedValue(1);

      await service.update(ORG_A, ACTOR, 'u2', { role: Role.RECRUITER });

      expect(prisma.user.count.mock.calls[0][0].where).toEqual({
        organizationId: ORG_A,
        role: Role.OWNER,
        id: { not: 'u2' },
      });
    });

    it('skips the owner check when the role is unchanged', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: Role.OWNER });

      await service.update(ORG_A, ACTOR, 'u2', { role: Role.OWNER });

      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes a teammate', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'u2',
        role: Role.RECRUITER,
      });

      await expect(service.remove(ORG_A, ACTOR, 'u2')).resolves.toEqual({
        id: 'u2',
        deleted: true,
      });
    });

    it('refuses self-deletion', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: ACTOR, role: Role.OWNER });

      await expect(service.remove(ORG_A, ACTOR, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('refuses to remove the last OWNER', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: Role.OWNER });
      prisma.user.count.mockResolvedValue(0);

      await expect(service.remove(ORG_A, ACTOR, 'u2')).rejects.toThrow(
        'must keep at least one OWNER',
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('refuses to remove a user from another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.remove(ORG_B, ACTOR, 'u2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });
  });
});
