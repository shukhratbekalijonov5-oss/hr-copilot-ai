import { ConflictException, HttpStatus } from '@nestjs/common';

/**
 * Professional-link product rules — the counterpart of document-policy.ts.
 *
 * A candidate maintains up to MAX_CANDIDATE_LINKS links AND up to
 * MAX_PERSONAL_DOCUMENTS files. The two budgets are INDEPENDENT and must stay
 * that way: 3 files + 3 links = 6 evidence sources is the intended maximum,
 * and there is deliberately no combined "6 sources" cap, because a person with
 * no portfolio site should not get extra file slots and vice versa.
 *
 * Like files, every existing link counts against the limit whatever its
 * status — including a FAILED one, which holds its slot until the candidate
 * deletes it. Deleting frees the slot immediately.
 *
 * Only the CANDIDATE ever writes here. There is no recruiter-side link
 * endpoint, by design: HR cannot add, edit, delete or reprocess a candidate's
 * links, exactly as they cannot upload a candidate's files.
 */
export const MAX_CANDIDATE_LINKS = 3;

/**
 * Machine-readable codes the frontend localizes on (en/ko/ru/uz), mirroring
 * DOCUMENT_ERROR_CODES. Part of the public API — rename only with a documented
 * migration. A foreign or unknown link id stays a code-less 404: it must be
 * indistinguishable from "does not exist".
 */
export const LINK_ERROR_CODES = {
  LINK_LIMIT_REACHED: 'LINK_LIMIT_REACHED',
  LINK_DUPLICATE: 'LINK_DUPLICATE',
  LINK_INVALID_URL: 'LINK_INVALID_URL',
  LINK_NOT_RETRYABLE: 'LINK_NOT_RETRYABLE',
  LINK_BUSY: 'LINK_BUSY',
} as const;

export type LinkErrorCode =
  (typeof LINK_ERROR_CODES)[keyof typeof LINK_ERROR_CODES];

/** 409 — the candidate's 4th link. Clean input for localized copy. */
export function linkLimitReached(): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    message:
      `You can save up to ${MAX_CANDIDATE_LINKS} professional links. ` +
      'Remove one to add another.',
    code: LINK_ERROR_CODES.LINK_LIMIT_REACHED,
  });
}

/** 409 — the same source under a different spelling of the same URL. */
export function linkAlreadyExists(): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'You have already added this link.',
    code: LINK_ERROR_CODES.LINK_DUPLICATE,
  });
}
