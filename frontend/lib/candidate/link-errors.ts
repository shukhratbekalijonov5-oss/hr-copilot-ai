import type { Dictionary } from "@/lib/i18n/dictionary";
import { LINK_FAILURE_CODES, type LinkFailureCode } from "@/lib/types";

/**
 * Turning link failures into something a person can act on.
 *
 * Two separate code spaces, both stable API contracts:
 *
 *  - REQUEST codes (`LINK_ERROR_CODES`) answer "why was my click rejected" —
 *    the fourth link, a duplicate, a URL the backend will not fetch.
 *  - FAILURE codes (`LinkFailureCode`) answer "why did processing fail" and
 *    live on the link row.
 *
 * Both localize on the CODE, never on the backend's message: the message is a
 * developer-facing detail that may quote a hostname or an HTTP status, and it
 * is only ever used as a last-resort fallback for an unrecognised code.
 */

export const LINK_ERROR_CODES = [
  "LINK_LIMIT_REACHED",
  "LINK_DUPLICATE",
  "LINK_INVALID_URL",
  "LINK_NOT_RETRYABLE",
  "LINK_BUSY",
] as const;

export type LinkErrorCode = (typeof LINK_ERROR_CODES)[number];

export function isLinkErrorCode(
  code: string | null | undefined,
): code is LinkErrorCode {
  return (LINK_ERROR_CODES as readonly string[]).includes(code ?? "");
}

export function isLinkFailureCode(
  code: string | null | undefined,
): code is LinkFailureCode {
  return (LINK_FAILURE_CODES as readonly string[]).includes(code ?? "");
}

/**
 * The message for a rejected request.
 *
 * A rejected URL carries the specific reason as `failureCode` when the backend
 * knows one — "this address is not publicly reachable" is far more useful than
 * "invalid link" — so that is preferred when present.
 */
export function localizedLinkError(
  code: string | null | undefined,
  d: Dictionary,
  fallback: string,
  failureCode?: string | null,
): string {
  if (code === "LINK_INVALID_URL" && isLinkFailureCode(failureCode)) {
    return d.candidateLinks.failureCodes[failureCode];
  }
  return isLinkErrorCode(code) ? d.candidateLinks.errorCodes[code] : fallback;
}

/** The reason shown under a FAILED link. */
export function localizedLinkFailure(
  code: string | null | undefined,
  d: Dictionary,
): string {
  return isLinkFailureCode(code)
    ? d.candidateLinks.failureCodes[code]
    : d.candidateLinks.failureCodes.UPSTREAM_ERROR;
}

/**
 * Whether a candidate can usefully press "Retry".
 *
 * Mirrors the backend's own split (see web-ingestion.errors.ts): a blocked
 * private target or a page with no readable content will fail identically
 * forever, and offering a button that cannot work is worse than not offering
 * one. The backend enforces this too — this only keeps the UI honest.
 */
const RETRYABLE_FAILURES: readonly LinkFailureCode[] = [
  "FETCH_TIMEOUT",
  "UPSTREAM_ERROR",
  "RENDER_FAILED",
  "INDEXING_FAILED",
];

export function linkFailureIsRetryable(
  code: string | null | undefined,
): boolean {
  return (
    isLinkFailureCode(code) &&
    (RETRYABLE_FAILURES as readonly string[]).includes(code)
  );
}
