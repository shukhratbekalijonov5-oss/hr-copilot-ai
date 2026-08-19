import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { Role } from '../../generated/prisma/enums';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Enforces @Roles(...). Runs after OrgContextGuard, so `user.role` is the
 * caller's role in the ACTIVE organization, freshly read from the membership
 * row — never a token claim and never a role from some other organization.
 * A user without organization context (`role === null`) fails every @Roles
 * check: candidate-only accounts hold no recruiter privileges.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    if (!user || user.role === null || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role for this operation');
    }
    return true;
  }
}
