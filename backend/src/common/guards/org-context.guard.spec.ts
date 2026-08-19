import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgContextGuard } from './org-context.guard';
import { Role } from '../../generated/prisma/enums';
import type { MembershipService } from '../membership/membership.service';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function contextFor(user?: Partial<AuthenticatedUser>): {
  context: ExecutionContext;
  request: { user?: AuthenticatedUser };
} {
  const request = {
    user: user
      ? {
          id: 'u1',
          email: 'a@b.test',
          organizationId: null,
          role: null,
          activeOrganizationClaim: null,
          ...user,
        }
      : undefined,
  };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('OrgContextGuard', () => {
  let reflector: Reflector;
  let findMembership: jest.Mock;
  let guard: OrgContextGuard;

  /** [isPublic, isOrgScoped] returned in reflector call order. */
  const routeFlags = (isPublic: boolean, orgScoped: boolean) =>
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(isPublic)
      .mockReturnValueOnce(orgScoped);

  beforeEach(() => {
    reflector = new Reflector();
    findMembership = jest.fn();
    guard = new OrgContextGuard(reflector, {
      findMembership,
    } as unknown as MembershipService);
  });

  it('validates the membership and attaches org + role for @OrgScoped routes', async () => {
    routeFlags(false, true);
    findMembership.mockResolvedValue({
      organizationId: ORG_A,
      role: Role.RECRUITER,
    });
    const { context, request } = contextFor({
      activeOrganizationClaim: ORG_A,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findMembership).toHaveBeenCalledWith('u1', ORG_A);
    expect(request.user!.organizationId).toBe(ORG_A);
    expect(request.user!.role).toBe(Role.RECRUITER);
  });

  it('resolves the role of the ACTIVE organization, never another one', async () => {
    // Same user is RECRUITER in A but INTERVIEWER in B. With B active, B's
    // role applies — A's privileges must never travel to B.
    routeFlags(false, true);
    findMembership.mockImplementation((_: string, org: string) =>
      Promise.resolve(
        org === ORG_A
          ? { organizationId: ORG_A, role: Role.RECRUITER }
          : { organizationId: ORG_B, role: Role.INTERVIEWER },
      ),
    );
    const { context, request } = contextFor({
      activeOrganizationClaim: ORG_B,
    });

    await guard.canActivate(context);

    expect(request.user!.organizationId).toBe(ORG_B);
    expect(request.user!.role).toBe(Role.INTERVIEWER);
  });

  it('rejects a token with no active organization (candidate-only session)', async () => {
    routeFlags(false, true);
    const { context } = contextFor({ activeOrganizationClaim: null });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('rejects a forged/foreign org claim: no membership row, no access', async () => {
    routeFlags(false, true);
    findMembership.mockResolvedValue(null);
    const { context, request } = contextFor({
      activeOrganizationClaim: 'org-i-do-not-belong-to',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(request.user!.organizationId).toBeNull();
    expect(request.user!.role).toBeNull();
  });

  it('rejects a REVOKED membership even though the token is still valid', async () => {
    // The claim was legitimate when signed; the row is gone now. The guard
    // consults the database on every request, so removal is immediate.
    routeFlags(false, true);
    findMembership.mockResolvedValue(null);
    const { context } = contextFor({ activeOrganizationClaim: ORG_A });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('uses the CURRENT role from the database, not any cached one', async () => {
    // Demoted OWNER -> INTERVIEWER: next request already carries the new role.
    routeFlags(false, true);
    findMembership.mockResolvedValue({
      organizationId: ORG_A,
      role: Role.INTERVIEWER,
    });
    const { context, request } = contextFor({
      activeOrganizationClaim: ORG_A,
    });

    await guard.canActivate(context);

    expect(request.user!.role).toBe(Role.INTERVIEWER);
  });

  it('passes routes without @OrgScoped through untouched', async () => {
    routeFlags(false, false);
    const { context, request } = contextFor({
      activeOrganizationClaim: ORG_A,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findMembership).not.toHaveBeenCalled();
    expect(request.user!.organizationId).toBeNull();
  });

  it('passes @Public routes through even under a class-level @OrgScoped', async () => {
    routeFlags(true, true);
    const { context } = contextFor(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it('refuses an @OrgScoped route that somehow has no authenticated user', async () => {
    routeFlags(false, true);
    const { context } = contextFor(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
