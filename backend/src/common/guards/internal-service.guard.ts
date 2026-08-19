import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const INTERNAL_TOKEN_HEADER = 'x-internal-service-token';

/**
 * Guards backend routes that only the Python AI service may call.
 *
 * This is the mirror image of the AI service's own guard: the same shared
 * INTERNAL_SERVICE_TOKEN, never a user JWT. Routes behind it carry no tenant
 * identity of their own, so they must never be reachable from a browser.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService
      .get<string>('ai.internalToken', '')
      .trim();

    if (!expected) {
      // Fail closed: an unset token must not mean "allow everyone".
      throw new ServiceUnavailableException(
        'Internal authentication is not configured',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[INTERNAL_TOKEN_HEADER];
    const token = Array.isArray(provided) ? provided[0] : provided;

    if (!token || !safeEqual(token, expected)) {
      // Identical response for missing and wrong tokens; nothing echoed back.
      throw new UnauthorizedException(
        'Invalid or missing internal service token',
      );
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
