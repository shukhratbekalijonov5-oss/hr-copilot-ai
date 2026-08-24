/**
 * Shared constants for the MAX premium external-AI features.
 *
 * Task 4C.6 implemented the first of them ("why this match"); this task adds
 * Cover Letter and Interview Prep. All three consume the same grounded
 * context, the same cache keying and the same failure contract — which is
 * why these pieces live in this shared module rather than inside any one
 * service. Advanced Match Breakdown, when built, starts here too.
 */

/** The answer's shape+prompt version. A change invalidates every cache entry. */
export const WHY_MATCH_VERSION = 'external-why-match-v1';

/**
 * The stable code the frontend switches on when generation is unavailable.
 *
 * One code for every underlying cause — provider outage, no key configured,
 * malformed output, timeout — because from the reader's side they are the
 * same event ("we could not write this right now"), and distinguishing them
 * would leak operational detail about a third party.
 */
export const AI_EXPLANATION_UNAVAILABLE = 'AI_EXPLANATION_UNAVAILABLE';

/**
 * How long a generated premium answer may sit in Redis. One number for every
 * premium feature — they age the same way.
 *
 * TTL is CLEANUP, not correctness. Rule N1 is enforced by the fingerprint in
 * the cache key: the moment the candidate's current state or the job's
 * canonical content changes, the old entry becomes unreachable rather than
 * stale-but-served. This number only stops Redis from keeping answers
 * nobody will ask for again.
 */
export const PREMIUM_AI_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Kept name from Task 4C.6; same value, not a second policy. */
export const WHY_MATCH_CACHE_TTL_SECONDS = PREMIUM_AI_CACHE_TTL_SECONDS;

/** Namespace for every premium-AI cache entry, so one SCAN can find them. */
export const PREMIUM_AI_CACHE_PREFIX = 'premium-ai';

/** Bounds mirrored from the AI service, enforced again on the way out. */
export const MAX_STRENGTHS = 4;
export const MAX_GAPS = 2;

/** The cover letter's shape+prompt version. A change invalidates its cache. */
export const COVER_LETTER_VERSION = 'external-cover-letter-v1';

/** The interview prep's shape+prompt version. */
export const INTERVIEW_PREP_VERSION = 'external-interview-prep-v1';

/**
 * Stable per-feature unavailability codes, same philosophy as
 * AI_EXPLANATION_UNAVAILABLE: one code per feature for every underlying
 * cause, so the frontend can label the right button without ever seeing a
 * provider's own words.
 */
export const AI_COVER_LETTER_UNAVAILABLE = 'AI_COVER_LETTER_UNAVAILABLE';
export const AI_INTERVIEW_PREP_UNAVAILABLE = 'AI_INTERVIEW_PREP_UNAVAILABLE';

/**
 * Bounds mirrored from the AI service, enforced again on the way out.
 * Upper bounds only — a sparse honest answer is kept sparse, never padded,
 * because padding means inventing a question or a qualification.
 */
export const MAX_INTERVIEW_QUESTIONS = 8;
export const MAX_FOCUS_AREAS = 4;
export const MAX_COVER_LETTER_SUBJECT_CHARS = 200;
export const MAX_COVER_LETTER_CHARS = 6000;

/** The match breakdown's shape+prompt version. */
export const MATCH_BREAKDOWN_VERSION = 'external-match-breakdown-v1';

/** Stable unavailability code for the breakdown, same philosophy as the rest. */
export const AI_MATCH_BREAKDOWN_UNAVAILABLE = 'AI_MATCH_BREAKDOWN_UNAVAILABLE';

/**
 * Breakdown bounds. Dimensions are derived deterministically from a fixed
 * catalogue (skills, seniority, work mode, employment type, location,
 * salary, languages — 7 today), so the cap of 9 is headroom, not a target:
 * a dimension with nothing real to say is omitted, never padded in.
 */
export const MAX_BREAKDOWN_DIMENSIONS = 9;
export const MAX_BREAKDOWN_VALUES = 12;
