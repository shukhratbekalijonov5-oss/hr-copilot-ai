import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../interfaces/authenticated-user.interface';

/**
 * Registered globally (see AppModule). Verifies the bearer token and attaches
 * a trusted AuthenticatedUser to the request.
 *
 * Note it never echoes the token back in an error message.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('auth.secretToken'),
      });
    } catch {
      // Intentionally opaque: never surface token contents or crypto details.
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload?.sub) {
      throw new UnauthorizedException('Malformed token payload');
    }

    // The token authenticates the USER only. The `org` claim is carried along
    // as an unvalidated pointer; OrgContextGuard turns it into a trusted
    // organizationId + role by checking a live membership row on org-scoped
    // routes. A candidate-only token legitimately has no org claim.
    const user: AuthenticatedUser = {
      id: payload.sub,
      email: payload.email,
      organizationId: null,
      role: null,
      activeOrganizationClaim: payload.org ?? null,
    };
    (request as Request & { user?: AuthenticatedUser }).user = user;
    return true;
  }
}

export function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}
