import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanCapabilityGuard } from './plan-capability.guard';
import { CandidateEntitlementsService } from './candidate-entitlements.service';
import { DbPlanSource } from './db-plan.source';
import type { PrismaService } from '../prisma/prisma.service';
import type { CandidatePlan } from '../generated/prisma/enums';

/**
 * The enforcement point. What matters here: ungated routes are untouched,
 * the plan is read live per request, and the refusal carries the stable
 * contract — never a bare 403 the frontend has to guess about.
 */

function guardWith(options: {
  capability?: string;
  isPublic?: boolean;
  plan?: CandidatePlan | null;
  user?: { id: string } | null;
}) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === 'isPublic') return options.isPublic ?? false;
      if (key === 'requiresCapability') return options.capability;
      return undefined;
    }),
  } as unknown as Reflector;

  const findUnique = jest
    .fn()
    .mockResolvedValue(
      options.plan === null ? null : { plan: options.plan ?? 'FREE' },
    );
  const entitlements = new CandidateEntitlementsService(
    new DbPlanSource({
      candidateAccount: { findUnique },
    } as unknown as PrismaService),
  );

  const context = {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        user: options.user === null ? undefined : { id: 'user-1' },
      }),
    }),
  } as unknown as ExecutionContext;

  return {
    guard: new PlanCapabilityGuard(reflector, entitlements),
    context,
    findUnique,
  };
}

describe('PlanCapabilityGuard', () => {
  it('lets every route without capability metadata straight through', async () => {
    const { guard, context, findUnique } = guardWith({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    // Ungated routes cost no plan lookup — ordinary internal search and
    // apply stay exactly as fast and as FREE as they were.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('lets @Public win, same precedence as every other guard', async () => {
    const { guard, context } = guardWith({
      capability: 'EXTERNAL_AI_SEARCH',
      isPublic: true,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('admits a plan that has the capability', async () => {
    const { guard, context } = guardWith({
      capability: 'INTERNAL_AI_SEARCH',
      plan: 'PRO',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('refuses with the full upgrade contract when the plan lacks it', async () => {
    const { guard, context } = guardWith({
      capability: 'EXTERNAL_AI_SEARCH',
      plan: 'PRO',
    });
    const refusal = guard.canActivate(context);
    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await refusal.catch((error: ForbiddenException) => {
      expect(error.getResponse()).toMatchObject({
        code: 'PLAN_UPGRADE_REQUIRED',
        requiredPlan: 'MAX',
        capability: 'EXTERNAL_AI_SEARCH',
      });
    });
  });

  it('treats a user with no candidate account as FREE — fail closed', async () => {
    const { guard, context } = guardWith({
      capability: 'INTERNAL_AI_SEARCH',
      plan: null,
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('reads the plan LIVE from the database, never from the request', async () => {
    const { guard, context, findUnique } = guardWith({
      capability: 'EXTERNAL_AI_SEARCH',
      plan: 'MAX',
    });
    await guard.canActivate(context);
    // The only input to the decision is the authenticated user id — there is
    // no code path from a body, query, cookie or header to the plan.
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { plan: true },
    });
  });

  it('refuses loudly if it ever runs without an authenticated user', async () => {
    const { guard, context } = guardWith({
      capability: 'EXTERNAL_AI_SEARCH',
      user: null,
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
