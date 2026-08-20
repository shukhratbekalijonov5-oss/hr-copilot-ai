import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CandidateContextGuard } from './candidate-context.guard';
import { AccountType } from '../../generated/prisma/enums';
import type { AccountTypeService } from '../identity/account-type.service';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

function contextFor(user?: Partial<AuthenticatedUser>): {
  context: ExecutionContext;
  request: { user?: AuthenticatedUser };
} {
  const request = {
    user: user
      ? {
          id: 'u1',
          email: 'a@b.test',
          accountType: null,
          organizationId: null,
          role: null,
          activeOrganizationClaim: null,
          sessionId: null,
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

describe('CandidateContextGuard', () => {
  let reflector: Reflector;
  let getForUser: jest.Mock;
  let guard: CandidateContextGuard;

  /** [isPublic, isCandidateScoped] returned in reflector call order. */
  const routeFlags = (isPublic: boolean, candidateScoped: boolean) =>
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(isPublic)
      .mockReturnValueOnce(candidateScoped);

  beforeEach(() => {
    reflector = new Reflector();
    getForUser = jest.fn();
    guard = new CandidateContextGuard(reflector, {
      getForUser,
    } as unknown as AccountTypeService);
  });

  it('admits a CANDIDATE account and attaches the live account type', async () => {
    routeFlags(false, true);
    getForUser.mockResolvedValue(AccountType.CANDIDATE);
    const { context, request } = contextFor({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getForUser).toHaveBeenCalledWith('u1');
    expect(request.user!.accountType).toBe(AccountType.CANDIDATE);
  });

  it('rejects an ORGANIZATION account with 403, whatever its token claims', async () => {
    routeFlags(false, true);
    getForUser.mockResolvedValue(AccountType.ORGANIZATION);
    const { context } = contextFor({ activeOrganizationClaim: 'org-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      expect.objectContaining({
        constructor: ForbiddenException,
        response: expect.objectContaining({
          code: 'AUTH_ACCOUNT_TYPE_MISMATCH',
        }),
      }),
    );
  });

  it('rejects a token whose user no longer exists', async () => {
    routeFlags(false, true);
    getForUser.mockResolvedValue(null);
    const { context } = contextFor({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('passes routes without @CandidateScoped through untouched', async () => {
    routeFlags(false, false);
    const { context, request } = contextFor({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getForUser).not.toHaveBeenCalled();
    expect(request.user!.accountType).toBeNull();
  });

  it('passes @Public routes through even under a class-level @CandidateScoped', async () => {
    routeFlags(true, true);
    const { context } = contextFor(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getForUser).not.toHaveBeenCalled();
  });

  it('refuses a @CandidateScoped route that somehow has no authenticated user', async () => {
    routeFlags(false, true);
    const { context } = contextFor(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
