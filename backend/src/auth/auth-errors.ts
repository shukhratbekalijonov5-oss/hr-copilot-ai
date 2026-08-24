import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Machine-readable auth error codes. Frontend/mobile localize on `code`
 * (en/ko/ru/uz); the English `message` is a developer courtesy, never the
 * localization source. Codes are part of the public API contract — rename
 * only with a documented migration.
 *
 * The account-type codes carry deliberate information-disclosure semantics:
 *
 *  - EMAIL_ALREADY_REGISTERED / ACCOUNT_TYPE_CONFLICT are REGISTRATION
 *    errors. Registration has always disclosed address existence (the old
 *    endpoint answered "Email is already registered"); distinguishing the
 *    conflicting type on top lets the UI point the person at the right
 *    sign-in instead of a dead end.
 *  - ACCOUNT_TYPE_MISMATCH is only ever raised AFTER a successful password
 *    verification (wrong-door login) or on an authenticated request hitting
 *    the other side's endpoints. Someone without valid credentials never
 *    sees it — login keeps answering a flat 401 "Invalid credentials".
 */
export const AUTH_ERROR_CODES = {
  INVALID_REFRESH_TOKEN: 'AUTH_INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_EXPIRED: 'AUTH_REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_REUSED: 'AUTH_REFRESH_TOKEN_REUSED',
  SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  SESSION_NOT_FOUND: 'AUTH_SESSION_NOT_FOUND',
  EMAIL_ALREADY_REGISTERED: 'AUTH_EMAIL_ALREADY_REGISTERED',
  ACCOUNT_TYPE_CONFLICT: 'AUTH_ACCOUNT_TYPE_CONFLICT',
  ACCOUNT_TYPE_MISMATCH: 'AUTH_ACCOUNT_TYPE_MISMATCH',
  LOGIN_TEMPORARILY_LOCKED: 'LOGIN_TEMPORARILY_LOCKED',
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

/** 409 with a stable `code` field — registration/invite conflicts. */
export function authConflict(
  code: AuthErrorCode,
  message: string,
): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    message,
    code,
  });
}

/** 403 with a stable `code` field — wrong-account-type access. */
export function authForbidden(
  code: AuthErrorCode,
  message: string,
): ForbiddenException {
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    message,
    code,
  });
}

/**
 * 429 for temporary login lockout. Deliberately carries NO hint about which
 * counter tripped or whether the account exists — only how long to wait.
 */
export function loginTemporarilyLocked(
  retryAfterSeconds: number,
): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      message: 'Too many sign-in attempts. Try again later.',
      code: AUTH_ERROR_CODES.LOGIN_TEMPORARILY_LOCKED,
      retryAfterSeconds,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
