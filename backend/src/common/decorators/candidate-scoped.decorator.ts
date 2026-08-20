import { SetMetadata } from '@nestjs/common';

export const CANDIDATE_SCOPED_KEY = 'candidateScoped';

/**
 * Marks a route/controller as candidate-only. CandidateContextGuard then
 * verifies — against the live database row, never a token claim — that the
 * authenticated user is a CANDIDATE account, and rejects ORGANIZATION
 * accounts with 403 AUTH_ACCOUNT_TYPE_MISMATCH.
 *
 * The counterpart of @OrgScoped: a route is candidate-scoped or org-scoped,
 * never both.
 */
export const CandidateScoped = () => SetMetadata(CANDIDATE_SCOPED_KEY, true);
