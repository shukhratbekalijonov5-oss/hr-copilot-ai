import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ORG_SCOPED_KEY } from '../decorators/org-scoped.decorator';
import { MembershipService } from '../membership/membership.service';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Resolves the active organization for routes marked @OrgScoped.
 *
 * Runs after JwtAuthGuard and before RolesGuard. The token's `org` claim is
 * only a pointer — this guard checks a LIVE OrganizationMember row on every
 * request, so:
 *
 *  - a removed member is rejected on their next request, token or not;
 *  - a demoted member immediately acts under the new role;
 *  - a CandidateAccount-only user (no memberships) can never reach recruiter
 *    functionality, whatever their token claims;
 *  - the same user switching organizations gets exactly that organization's
 *    role — privileges never travel between tenants.
 *
 * Routes without @OrgScoped pass through untouched and keep
 * `organizationId === null`, so they cannot address tenant data at all.
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    // @Public wins over a class-level @OrgScoped (e.g. the signed local
    // download route inside the documents controller) — same precedence as
    // JwtAuthGuard, which never attached a user to the request here.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const orgScoped = this.reflector.getAllAndOverride<boolean>(
      ORG_SCOPED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!orgScoped) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      // @OrgScoped on a @Public route is a programming error; refuse loudly.
      throw new UnauthorizedException('Authentication required');
    }

    if (!user.activeOrganizationClaim) {
      throw new ForbiddenException(
        'No active organization selected. Use /auth/switch-organization first.',
      );
    }

    const membership = await this.memberships.findMembership(
      user.id,
      user.activeOrganizationClaim,
    );
    if (!membership) {
      // Same message whether the organization does not exist or the caller
      // simply is not in it — existence of foreign organizations is not
      // confirmed here.
      throw new ForbiddenException(
        'You are not a member of the selected organization',
      );
    }

    user.organizationId = membership.organizationId;
    user.role = membership.role;
    return true;
  }
}
