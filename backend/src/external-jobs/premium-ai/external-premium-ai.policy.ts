/**
 * Shared constants for the MAX premium external-AI features.
 *
 * Task 4C.6 implements the first of them ("why this match"). Cover Letter,
 * Interview Prep and Advanced Match Breakdown are deliberately NOT built
 * here — but they will consume the same grounded context, the same cache
 * keying and the same failure contract, which is why those pieces live in
 * this shared module rather than inside the why-match service.
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
 * How long a generated explanation may sit in Redis.
 *
 * TTL is CLEANUP, not correctness. Rule N1 is enforced by the fingerprint in
 * the cache key: the moment the candidate's current state or the job's
 * canonical content changes, the old entry becomes unreachable rather than
 * stale-but-served. This number only stops Redis from keeping explanations
 * nobody will ask for again.
 */
export const WHY_MATCH_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Namespace for every premium-AI cache entry, so one SCAN can find them. */
export const PREMIUM_AI_CACHE_PREFIX = 'premium-ai';

/** Bounds mirrored from the AI service, enforced again on the way out. */
export const MAX_STRENGTHS = 4;
export const MAX_GAPS = 2;
