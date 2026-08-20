/**
 * Client-safe query limits, mirroring the backend DTOs.
 *
 * In their own module because the search form (a client component) needs the
 * numbers, while the fetchers that also use them sit behind `server-only`
 * imports a client bundle must never pull in.
 */

/** Matches the backend's EvidenceSearchDto MinLength. */
export const MIN_EVIDENCE_QUERY_LENGTH = 2;
/** Matches the backend's AiAnswerDto MinLength — one shorter and it is a 400. */
export const MIN_ANSWER_QUERY_LENGTH = 3;
