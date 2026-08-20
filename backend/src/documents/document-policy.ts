import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';

/**
 * Document ownership & upload policy — the single place the product rules
 * live, shared by every upload path (recruiter and candidate).
 *
 * Two disjoint ownership models exist and must never be collapsed:
 *
 *  - ORGANIZATION documents (`organizationId` set): recruiter uploads for
 *    manually added candidates, and org-scoped snapshot copies made at apply
 *    time. Indexed into the tenant collection; feed Recruiter AI Search.
 *  - PERSONAL documents (`candidateAccountId` set): a job seeker's own files.
 *    Indexed into the physically separate candidate collection; feed
 *    Candidate AI Job Match. Never reachable through tenant queries.
 *
 * HR may upload ONLY for a manually added candidate of its own organization —
 * a Candidate row with `candidateAccountId = null`. A linked row means the
 * person applied through the platform themselves; their evidence then comes
 * exclusively from the snapshots their own applications created, and HR must
 * not graft additional files onto that identity.
 *
 * A CandidateAccount owns at most MAX_PERSONAL_DOCUMENTS personal files.
 * Every existing (non-deleted) personal document counts — including FAILED
 * ones, which hold a slot until the candidate deletes them; deletion frees
 * the slot immediately.
 */
export const MAX_PERSONAL_DOCUMENTS = 3;

/**
 * Fallback for `storage.maxFileSizeBytes` (env: MAX_FILE_SIZE_BYTES) wherever
 * the config key is read — one constant, no scattered `50 * 1024 * 1024`.
 */
export const DEFAULT_MAX_DOCUMENT_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Machine-readable document error codes, mirroring the AUTH_ERROR_CODES
 * contract: the frontend localizes on `code` (en/ko/ru/uz), never on
 * `message`. Codes are part of the public API — rename only with a documented
 * migration. Not-found/not-owned stays the conventional code-less 404: a
 * foreign document is indistinguishable from a non-existent one by design.
 */
export const DOCUMENT_ERROR_CODES = {
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  PERSONAL_DOCUMENT_LIMIT_REACHED: 'PERSONAL_DOCUMENT_LIMIT_REACHED',
  HR_DOCUMENT_UPLOAD_NOT_ALLOWED: 'HR_DOCUMENT_UPLOAD_NOT_ALLOWED',
} as const;

export type DocumentErrorCode =
  (typeof DOCUMENT_ERROR_CODES)[keyof typeof DOCUMENT_ERROR_CODES];

/** 413 with a stable `code` — the size cap, from any validation layer. */
export function fileTooLarge(
  maxFileSizeBytes: number,
): PayloadTooLargeException {
  const limitMb = Math.floor(maxFileSizeBytes / (1024 * 1024));
  return new PayloadTooLargeException({
    statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
    error: 'Payload Too Large',
    message: `File exceeds the ${limitMb} MB limit`,
    code: DOCUMENT_ERROR_CODES.FILE_TOO_LARGE,
  });
}

/** 400 with a stable `code` — wrong type, extension or content. */
export function unsupportedFileType(message: string): BadRequestException {
  return new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message,
    code: DOCUMENT_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
  });
}

/** 409 — the candidate's 4th-file upload; clean input for localized copy. */
export function personalDocumentLimitReached(): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    message:
      `You can store up to ${MAX_PERSONAL_DOCUMENTS} documents. ` +
      'Delete one to upload another.',
    code: DOCUMENT_ERROR_CODES.PERSONAL_DOCUMENT_LIMIT_REACHED,
  });
}

/** 403 — HR upload against a candidate the policy does not allow. */
export function hrUploadNotAllowed(message: string): ForbiddenException {
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    message,
    code: DOCUMENT_ERROR_CODES.HR_DOCUMENT_UPLOAD_NOT_ALLOWED,
  });
}
