import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';

/**
 * Account (self-service profile) policy — the one place the rules for editing
 * *your own* identity live.
 *
 * The subject of every rule here is the caller. There is no id in any account
 * route, so "may I edit this profile?" never becomes a question: the only
 * profile reachable is the one the access token was minted for.
 */

/**
 * Profile pictures are small by design — an avatar is rendered at 48px, and a
 * 50 MB one would only cost bandwidth on every page. Deliberately its own
 * limit rather than the document ceiling: they are different products of
 * different rules.
 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Images only, and only formats every target browser renders. GIF and SVG are
 * excluded on purpose: SVG is an executable document (scripts, external refs)
 * that would be served from our own origin.
 */
export const ALLOWED_AVATAR_MIME_TYPES: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

/**
 * Machine-readable account error codes. Same contract as AUTH_ERROR_CODES and
 * DOCUMENT_ERROR_CODES: the frontend localizes on `code` (en/ko/ru/uz), never
 * on `message`, so these names are public API.
 */
export const ACCOUNT_ERROR_CODES = {
  EMAIL_ALREADY_IN_USE: 'EMAIL_ALREADY_IN_USE',
  UNSUPPORTED_IMAGE_TYPE: 'UNSUPPORTED_IMAGE_TYPE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  NO_AVATAR: 'NO_AVATAR',
} as const;

export type AccountErrorCode =
  (typeof ACCOUNT_ERROR_CODES)[keyof typeof ACCOUNT_ERROR_CODES];

/**
 * 409 — the new address belongs to somebody else.
 *
 * Deliberately the same answer whether the holder is a candidate or an
 * organization account: which kind of account owns an address is not something
 * a signed-in stranger gets to enumerate.
 */
export function emailAlreadyInUse(): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'That email address is already in use',
    code: ACCOUNT_ERROR_CODES.EMAIL_ALREADY_IN_USE,
  });
}

/** 400 — wrong type, extension, or content that is not the image it claims. */
export function unsupportedImageType(message: string): BadRequestException {
  return new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message,
    code: ACCOUNT_ERROR_CODES.UNSUPPORTED_IMAGE_TYPE,
  });
}

/** 413 — over MAX_AVATAR_BYTES. */
export function imageTooLarge(): PayloadTooLargeException {
  const limitMb = Math.floor(MAX_AVATAR_BYTES / (1024 * 1024));
  return new PayloadTooLargeException({
    statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
    error: 'Payload Too Large',
    message: `Image exceeds the ${limitMb} MB limit`,
    code: ACCOUNT_ERROR_CODES.IMAGE_TOO_LARGE,
  });
}
