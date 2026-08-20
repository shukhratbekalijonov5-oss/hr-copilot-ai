import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CANDIDATE_SCOPED_KEY } from '../decorators/candidate-scoped.decorator';
import { AccountTypeService } from '../identity/account-type.service';
import { AUTH_ERROR_CODES, authForbidden } from '../../auth/auth-errors';
import { AccountType } from '../../generated/prisma/enums';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * The candidate-side counterpart of OrgContextGuard, for routes marked
 * @CandidateScoped.
 *
 * Runs after JwtAuthGuard. The token carries no account type (deliberately —
 * see JwtPayload); this guard reads the LIVE users.accountType row on every
 * request, so:
 *
 *  - an ORGANIZATION account can never call candidate endpoints (profile,
 *    resume, saved jobs, applications, AI Job Match), whatever its token says;
 *  - a deleted account stops working on its next request.
 *
 * CandidateAccount OWNERSHIP stays enforced in the services, which resolve
 * everything through the authenticated userId — this guard adds the account
 * TYPE boundary on top.
 */
@Injectable()
export class CandidateContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accountTypes: AccountTypeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    // Same precedence as JwtAuthGuard/OrgContextGuard: @Public wins over a
    // class-level @CandidateScoped.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const candidateScoped = this.reflector.getAllAndOverride<boolean>(
      CANDIDATE_SCOPED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!candidateScoped) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      // @CandidateScoped on a @Public route is a programming error; refuse loudly.
      throw new UnauthorizedException('Authentication required');
    }

    const accountType = await this.accountTypes.getForUser(user.id);
    if (accountType === null) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (accountType !== AccountType.CANDIDATE) {
      throw authForbidden(
        AUTH_ERROR_CODES.ACCOUNT_TYPE_MISMATCH,
        'This endpoint is only available to candidate accounts',
      );
    }

    user.accountType = accountType;
    return true;
  }
}
