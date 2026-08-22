import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';

/**
 * Document ownership & upload policy — the single place the product rules
 * live.
 *
 * There is exactly ONE upload path in the product: a candidate uploading their
 * own file. HR cannot upload a document for anyone; the capability was removed
 * from the API, not merely from the UI.
 *
 * Two disjoint ownership models exist and must never be collapsed:
 *
 *  - PERSONAL documents (`candidateAccountId` set): a job seeker's own files,
 *    the only thing anybody uploads. Indexed into the physically separate
 *    candidate collection; feed Candidate AI Job Match. Never reachable
 *    through tenant queries.
 *  - ORGANIZATION documents (`organizationId` set): org-scoped snapshot copies
 *    made at APPLY time from the resume the candidate submitted. Indexed into
 *    the tenant collection; the only evidence Recruiter AI Search can reach.
 *    Created by the apply flow alone — no request body can produce one.
 *
 * The snapshot is what keeps the two sides honest: a recruiter sees the file a
 * person deliberately sent to THAT vacancy, and replacing (or deleting) the
 * personal original later never rewrites an application's history.
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
  /** 409 — retry requested for a document that is not in FAILED state. */
  DOCUMENT_NOT_RETRYABLE: 'DOCUMENT_NOT_RETRYABLE',
  /** 409 — retry requested while an indexing job is already live. */
  DOCUMENT_BUSY: 'DOCUMENT_BUSY',
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
