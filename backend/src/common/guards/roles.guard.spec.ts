import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../../generated/prisma/enums';

function contextWithRole(role?: Role): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () =>
        role ? { user: { id: 'u1', role, organizationId: 'org-1' } } : {},
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const requireRoles = (roles?: Role[]) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  it('allows a route with no @Roles() metadata', () => {
    requireRoles(undefined);
    expect(guard.canActivate(contextWithRole(Role.INTERVIEWER))).toBe(true);
  });

  it('allows a user holding a required role', () => {
    requireRoles([Role.OWNER, Role.HR_ADMIN]);
    expect(guard.canActivate(contextWithRole(Role.HR_ADMIN))).toBe(true);
  });

  it('blocks a user without a required role', () => {
    requireRoles([Role.OWNER, Role.HR_ADMIN]);
    expect(() => guard.canActivate(contextWithRole(Role.INTERVIEWER))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks an unauthenticated request', () => {
    requireRoles([Role.OWNER]);
    expect(() => guard.canActivate(contextWithRole())).toThrow(
      ForbiddenException,
    );
  });

  it('treats an empty roles list as unrestricted', () => {
    requireRoles([]);
    expect(guard.canActivate(contextWithRole(Role.INTERVIEWER))).toBe(true);
  });
});
