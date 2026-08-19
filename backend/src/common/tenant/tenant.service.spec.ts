import { NotFoundException } from '@nestjs/common';
import { TenantService } from './tenant.service';

describe('TenantService', () => {
  const tenant = new TenantService();
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  describe('scope', () => {
    it('produces a where-fragment bound to the given organization', () => {
      expect(tenant.scope(ORG_A)).toEqual({ organizationId: ORG_A });
    });
  });

  describe('assertOwned', () => {
    it('returns the entity when it belongs to the organization', () => {
      const entity = { organizationId: ORG_A, id: '1' };
      expect(tenant.assertOwned(entity, ORG_A)).toBe(entity);
    });

    it('rejects an entity owned by a different organization', () => {
      const foreign = { organizationId: ORG_B, id: '1' };
      expect(() => tenant.assertOwned(foreign, ORG_A)).toThrow(NotFoundException);
    });

    it('reports cross-tenant access as 404, never 403', () => {
      // A 403 would confirm the id exists in another organization, which is
      // itself an information leak.
      const foreign = { organizationId: ORG_B, id: '1' };
      try {
        tenant.assertOwned(foreign, ORG_A, 'Candidate');
        fail('expected a NotFoundException');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getStatus()).toBe(404);
        expect((error as NotFoundException).message).toBe('Candidate not found');
      }
    });

    it('rejects null and undefined', () => {
      expect(() => tenant.assertOwned(null, ORG_A)).toThrow(NotFoundException);
      expect(() => tenant.assertOwned(undefined, ORG_A)).toThrow(NotFoundException);
    });
  });

  describe('assertFound', () => {
    it('passes through a present entity, including falsy-but-valid values', () => {
      expect(tenant.assertFound({ id: '1' })).toEqual({ id: '1' });
      expect(tenant.assertFound(0)).toBe(0);
      expect(tenant.assertFound('')).toBe('');
      expect(tenant.assertFound(false)).toBe(false);
    });

    it('throws for null and undefined', () => {
      expect(() => tenant.assertFound(null, 'Vacancy')).toThrow('Vacancy not found');
      expect(() => tenant.assertFound(undefined, 'Vacancy')).toThrow(NotFoundException);
    });
  });
});
