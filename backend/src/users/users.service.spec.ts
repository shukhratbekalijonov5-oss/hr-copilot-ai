import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { TenantService } from '../common/tenant/tenant.service';
import { MembershipService } from '../common/membership/membership.service';
import { Role } from '../generated/prisma/enums';
import type { PrismaService } from '../prisma/prisma.service';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const ACTOR = 'actor-1';

function createPrismaMock() {
  return {
    organizationMember: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({ id: 'm1' }),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

/** A membership row in the shape MEMBER_SELECT produces. */
function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    role: Role.RECRUITER,
    createdAt: new Date('2026-01-05'),
    updatedAt: new Date('2026-01-06'),
    organizationId: ORG_A,
    user: {
      id: 'u2',
      email: 'member@example.test',
      fullName: 'Member Two',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    },
    ...overrides,
  };
}

describe('UsersService (team = organization memberships)', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: UsersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new UsersService(
      prisma as unknown as PrismaService,
      new TenantService(),
      new MembershipService(prisma as unknown as PrismaService),
    );
    prisma.organizationMember.update.mockResolvedValue(memberRow());
  });

  describe('findAll — tenant isolation', () => {
    it('lists only memberships of the caller organization', async () => {
      await service.findAll(ORG_A, { page: 1, limit: 20, skip: 0 });

      expect(
        prisma.organizationMember.findMany.mock.calls[0][0].where
          .organizationId,
      ).toBe(ORG_A);
    });

    it('keeps the tenant filter alongside a search and role filter', async () => {
      await service.findAll(ORG_A, {
        page: 1,
        limit: 20,
        skip: 0,
        search: 'dana',
        role: Role.OWNER,
      });

      const where = prisma.organizationMember.findMany.mock.calls[0][0].where;
      expect(where.organizationId).toBe(ORG_A);
      expect(where.role).toBe(Role.OWNER);
      expect(where.user.OR).toHaveLength(2);
    });

    it('never selects passwordHash and flattens user info with the role', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([memberRow()]);
      prisma.organizationMember.count.mockResolvedValue(1);

      const result = await service.findAll(ORG_A, {
        page: 1,
        limit: 20,
        skip: 0,
      });

      const select = prisma.organizationMember.findMany.mock.calls[0][0].select;
      expect(select.user.select).not.toHaveProperty('passwordHash');
      const [row] = result.data as Record<string, unknown>[];
      expect(row).toMatchObject({
        id: 'u2',
        email: 'member@example.test',
        role: Role.RECRUITER,
        organizationId: ORG_A,
        membershipId: 'm1',
      });
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });
  });

  describe('findOne', () => {
    it('resolves the membership by (userId, organizationId)', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(memberRow());

      const result = await service.findOne(ORG_A, 'u2');

      expect(
        prisma.organizationMember.findUnique.mock.calls[0][0].where,
      ).toEqual({
        userId_organizationId: { userId: 'u2', organizationId: ORG_A },
      });
      expect((result as { role: Role }).role).toBe(Role.RECRUITER);
    });

    it('404s for a user who is not a member of this organization', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(service.findOne(ORG_B, 'u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates a teammate name through the membership', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        role: Role.RECRUITER,
      });

      await service.update(ORG_A, ACTOR, 'u2', { fullName: 'New Name' });

      expect(prisma.organizationMember.update.mock.calls[0][0].data).toEqual({
        user: { update: { fullName: 'New Name' } },
      });
    });

    it('refuses to update a member of another organization', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(
        service.update(ORG_B, ACTOR, 'u2', { role: Role.OWNER }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.organizationMember.update).not.toHaveBeenCalled();
    });

    it('blocks self-promotion', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: ACTOR,
        role: Role.RECRUITER,
      });

      await expect(
        service.update(ORG_A, ACTOR, ACTOR, { role: Role.OWNER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.organizationMember.update).not.toHaveBeenCalled();
    });

    it('allows a user to rename themselves', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: ACTOR,
        role: Role.RECRUITER,
      });

      await service.update(ORG_A, ACTOR, ACTOR, { fullName: 'Renamed' });

      expect(prisma.organizationMember.update).toHaveBeenCalled();
    });

    it('refuses to demote the last OWNER (live database count, not token state)', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        role: Role.OWNER,
      });
      prisma.organizationMember.count.mockResolvedValue(0); // no other owners

      await expect(
        service.update(ORG_A, ACTOR, 'u2', { role: Role.RECRUITER }),
      ).rejects.toThrow('must keep at least one OWNER');
      expect(prisma.organizationMember.update).not.toHaveBeenCalled();
    });

    it('allows demoting an OWNER when another OWNER remains', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        role: Role.OWNER,
      });
      prisma.organizationMember.count.mockResolvedValue(1);

      await service.update(ORG_A, ACTOR, 'u2', { role: Role.RECRUITER });

      expect(prisma.organizationMember.update).toHaveBeenCalled();
    });

    it('counts remaining owners within the caller organization only', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        role: Role.OWNER,
      });
      prisma.organizationMember.count.mockResolvedValue(1);

      await service.update(ORG_A, ACTOR, 'u2', { role: Role.RECRUITER });

      expect(prisma.organizationMember.count.mock.calls[0][0].where).toEqual({
        organizationId: ORG_A,
        role: Role.OWNER,
        userId: { not: 'u2' },
      });
    });

    it('skips the owner check when the role is unchanged', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        role: Role.OWNER,
      });

      await service.update(ORG_A, ACTOR, 'u2', { role: Role.OWNER });

      expect(prisma.organizationMember.count).not.toHaveBeenCalled();
      expect(prisma.organizationMember.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the MEMBERSHIP, never the user account', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        role: Role.RECRUITER,
      });

      await expect(service.remove(ORG_A, ACTOR, 'u2')).resolves.toEqual({
        id: 'u2',
        deleted: true,
      });
      expect(prisma.organizationMember.delete.mock.calls[0][0].where).toEqual({
        id: 'm1',
      });
    });

    it('refuses removing yourself from the organization', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: ACTOR,
        role: Role.OWNER,
      });

      await expect(service.remove(ORG_A, ACTOR, ACTOR)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.organizationMember.delete).not.toHaveBeenCalled();
    });

    it('refuses to remove the last OWNER', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        role: Role.OWNER,
      });
      prisma.organizationMember.count.mockResolvedValue(0);

      await expect(service.remove(ORG_A, ACTOR, 'u2')).rejects.toThrow(
        'must keep at least one OWNER',
      );
      expect(prisma.organizationMember.delete).not.toHaveBeenCalled();
    });

    it('refuses to remove a member of another organization', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);

      await expect(service.remove(ORG_B, ACTOR, 'u2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.organizationMember.delete).not.toHaveBeenCalled();
    });
  });
});
