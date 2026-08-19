import { HttpStatus, UnauthorizedException } from '@nestjs/common';

/**
 * Machine-readable auth error codes. Frontend/mobile localize on `code`
 * (en/ko/ru/uz); the English `message` is a developer courtesy, never the
 * localization source. Codes are part of the public API contract — rename
 * only with a documented migration.
 */
export const AUTH_ERROR_CODES = {
  INVALID_REFRESH_TOKEN: 'AUTH_INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_EXPIRED: 'AUTH_REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_REUSED: 'AUTH_REFRESH_TOKEN_REUSED',
  SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  SESSION_NOT_FOUND: 'AUTH_SESSION_NOT_FOUND',
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

/**
 * 401 with a stable `code` field. Built on UnauthorizedException so the
 * global filter and every existing 401 expectation keep working; the object
 * body is passed through verbatim by AllExceptionsFilter.
 */
export function authUnauthorized(
  code: AuthErrorCode,
  message: string,
): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: HttpStatus.UNAUTHORIZED,
    error: 'Unauthorized',
    message,
    code,
  });
}
