import { Injectable, NotFoundException } from '@nestjs/common';

/** Anything persisted under an organization. */
export interface OrganizationScoped {
  organizationId: string;
}

/**
 * Central helpers for multi-tenant isolation.
 *
 * Rules this service exists to make unavoidable:
 *
 *  1. `organizationId` always comes from the authenticated user, never from
 *     client input. DTOs deliberately do not declare an `organizationId` field
 *     and the global ValidationPipe runs with `forbidNonWhitelisted`, so a
 *     client that tries to send one gets a 400 rather than silent acceptance.
 *
 *  2. A cross-tenant read is reported as 404, not 403. A 403 would confirm
 *     that the id exists in *some* other organization, which is itself a leak.
 */
@Injectable()
export class TenantService {
  /** Spread into any Prisma `where` clause for an org-scoped model. */
  scope(organizationId: string): { organizationId: string } {
    return { organizationId };
  }

  /**
   * Returns the entity if it belongs to the caller's organization, otherwise
   * throws NotFound. Use for rows fetched without an organizationId filter.
   */
  assertOwned<T extends OrganizationScoped>(
    entity: T | null | undefined,
    organizationId: string,
    resourceName = 'Resource',
  ): T {
    if (!entity || entity.organizationId !== organizationId) {
      throw new NotFoundException(`${resourceName} not found`);
    }
    return entity;
  }

  /** Same as assertOwned but for rows whose tenancy is inherited via a parent. */
  assertFound<T>(entity: T | null | undefined, resourceName = 'Resource'): T {
    if (entity === null || entity === undefined) {
      throw new NotFoundException(`${resourceName} not found`);
    }
    return entity;
  }
}
