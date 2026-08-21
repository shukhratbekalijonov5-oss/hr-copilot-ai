import { ApplicationSource } from '../../generated/prisma/enums';
import type { Prisma } from '../../generated/prisma/client';

/**
 * WHO is a recruiter-visible candidate, in one place.
 *
 * The product has exactly one candidate-entry path: a person with a
 * CandidateAccount applies to an OPEN vacancy themselves. Recruiters can no
 * longer create candidates, attach existing ones to their vacancies, or upload
 * files on anyone's behalf — so every candidate an HR user works with is
 * backed by a real platform identity that chose to apply.
 *
 * Two conditions define that, and both are checked rather than trusting
 * either alone:
 *
 *   application.source === DIRECT      -> the association came from an apply
 *   candidate.candidateAccountId != null -> a real person owns this record
 *
 * Historical rows from the removed features (recruiter-created candidates and
 * MANUAL_UPLOAD associations) are NOT deleted — they stay in the database with
 * their truthful provenance — but they fail this predicate, so they never
 * appear in an applicant list, a Compare pool, AI Search results, Candidate
 * Detail or any AI grounding path. "Not exposed" is enforced by these filters,
 * not by destroying data.
 */

/** The candidate half: a platform account owns this org-side record. */
export const APPLICANT_CANDIDATE_SCOPE = {
  candidateAccountId: { not: null },
} satisfies Prisma.CandidateWhereInput;

/** The association half: this row is a genuine application. */
export const APPLICANT_APPLICATION_SCOPE = {
  source: ApplicationSource.DIRECT,
  candidate: APPLICANT_CANDIDATE_SCOPE,
} satisfies Prisma.ApplicationWhereInput;
