import type { ExternalApplicationStatus } from '../../generated/prisma/enums';

/**
 * The candidate's self-reported application stages, in full.
 *
 * Deliberately small. Every value is something the CANDIDATE can truthfully
 * state about their own actions or what they were told; there is no
 * SCREENING, SHORTLISTED or HIRED because those are the employer's states,
 * observed from a pipeline this product cannot see. OFFER is the last stage
 * we track — pretending to know employment outcomes adds a state nobody
 * maintains.
 *
 * No transition rules: this is a personal notebook, and its owner may correct
 * any entry to any value at any time.
 */
export const EXTERNAL_APPLICATION_STATUSES = [
  'APPLIED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
] as const satisfies readonly ExternalApplicationStatus[];

/** Free text, bounded. A note, not a document. */
export const MAX_TRACKING_NOTE_LENGTH = 2000;

/**
 * How far into the future a self-reported `appliedAt` may sit.
 *
 * Zero would refuse an honest "just now" from a client whose clock runs a
 * minute ahead; anything generous would store applications that have not
 * happened. One hour absorbs clock skew and nothing else.
 */
export const MAX_APPLIED_AT_FUTURE_MS = 60 * 60 * 1000;

/** The stable conflict code the frontend switches on. */
export const ALREADY_TRACKED_CODE = 'EXTERNAL_APPLICATION_ALREADY_TRACKED';
