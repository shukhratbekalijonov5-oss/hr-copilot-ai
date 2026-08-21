import { ForbiddenException, HttpStatus } from '@nestjs/common';

/**
 * Vacancy-scoped HR workspace policy.
 *
 * The product rule: an HR user works inside vacancies THEY PERSONALLY
 * CREATED. A vacancy belongs to one organization AND one creator, and every
 * vacancy-dependent operation (mutation, applicant pipeline, Compare,
 * candidate-detail AI, AI Search context, interview chat, processing filter)
 * must satisfy BOTH:
 *
 *     vacancy.organizationId === caller's active organization
 *     vacancy.createdById    === caller's user id
 *
 * Disclosure semantics, deliberately asymmetric and documented:
 *
 *  - FOREIGN-ORG (or unknown) vacancy → 404, the project-wide tenant
 *    nondisclosure convention: existence is never confirmed across tenants.
 *  - SAME-ORG, DIFFERENT CREATOR → 403 VACANCY_NOT_OWNED. The vacancy is
 *    already visible to every member through the org-wide listings, so an
 *    honest "not yours to operate" leaks nothing and tells the frontend
 *    exactly what to render.
 *  - CONVERSATIONS are the exception: they were never org-browsable, so a
 *    non-creator probing a conversation id gets 404 (indistinguishable from
 *    non-existent), not 403.
 *
 * Reads of the vacancy CATALOG (org-wide list/detail) stay organization
 * -scoped: seeing that a colleague's vacancy exists is fine; working inside
 * it is not.
 */
export const VACANCY_ERROR_CODES = {
  VACANCY_NOT_OWNED: 'VACANCY_NOT_OWNED',
  CANDIDATE_NOT_IN_VACANCY: 'CANDIDATE_NOT_IN_VACANCY',
} as const;

export type VacancyErrorCode =
  (typeof VACANCY_ERROR_CODES)[keyof typeof VACANCY_ERROR_CODES];

/** Upper bound for one bulk-delete request. A UI selection, not a purge-all. */
export const MAX_BULK_DELETE_VACANCIES = 50;

/** 403 — same-org vacancy created by another HR user. */
export function vacancyNotOwned(): ForbiddenException {
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    message:
      'This vacancy was created by another member of your organization. ' +
      'You can only work inside vacancies you created.',
    code: VACANCY_ERROR_CODES.VACANCY_NOT_OWNED,
  });
}

/** 403 — the candidate is not associated with the selected vacancy. */
export function candidateNotInVacancy(): ForbiddenException {
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    message: 'This candidate is not associated with the selected vacancy.',
    code: VACANCY_ERROR_CODES.CANDIDATE_NOT_IN_VACANCY,
  });
}
