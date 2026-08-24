import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { REQUIRES_CAPABILITY_KEY } from './requires-capability.decorator';
import { CandidateEntitlementsService } from './candidate-entitlements.service';
import {
  planUpgradeRequired,
  type CandidateCapability,
} from './candidate-plan.policy';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

/**
 * The ONE place plan entitlements are enforced.
 *
 * A global guard triggered by @RequiresCapability metadata, exactly like
 * CandidateContextGuard is triggered by @CandidateScoped — so gating a new
 * surface is one decorator, never a per-controller check that can be
 * forgotten or drift.
 *
 * Registered AFTER JwtAuthGuard / CandidateContextGuard / OrgContextGuard /
 * RolesGuard, deliberately: identity and account-type refusals must win.
 * A recruiter calling external search gets AUTH_ACCOUNT_TYPE_MISMATCH (this
 * surface is not theirs at any price), never a misleading upgrade prompt.
 *
 * The plan is resolved LIVE from CandidateEntitlementsService on every
 * gated request — never from a token claim, so an upgrade or downgrade takes
 * effect on the next request, and nothing a client sends can influence the
 * answer.
 */
@Injectable()
export class PlanCapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: CandidateEntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const capability = this.reflector.getAllAndOverride<
      CandidateCapability | undefined
    >(REQUIRES_CAPABILITY_KEY, [context.getHandler(), context.getClass()]);
    if (!capability) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      // A capability-gated route without an authenticated user means the
      // guard order is broken. Refuse loudly rather than answering as FREE.
      throw new UnauthorizedException('Authentication required');
    }

    if (await this.entitlements.can(user.id, capability)) return true;
    throw planUpgradeRequired(capability);
  }
}
