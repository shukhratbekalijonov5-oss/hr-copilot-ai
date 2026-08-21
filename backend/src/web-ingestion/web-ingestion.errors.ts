import { LinkFailureCode } from '../generated/prisma/enums';

/**
 * A typed ingestion failure.
 *
 * `code` is the stable, machine-readable contract the frontend localizes on
 * (en/ko/ru/uz). `detail` is for logs and support — it may name a hostname or
 * an HTTP status, and it is never rendered to a candidate raw, because an
 * unfiltered upstream error is exactly where internal hostnames, resolver
 * output and stack traces leak.
 */
export class WebIngestionError extends Error {
  constructor(
    readonly code: LinkFailureCode,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'WebIngestionError';
  }
}

/**
 * Whether retrying could ever produce a different outcome.
 *
 * The split is a policy statement, not a guess: a private-network target, an
 * unsupported protocol, a malformed URL or a page with no meaningful content
 * will fail identically forever, and retrying them only burns worker time and
 * hammers someone else's server. A timeout, an upstream 5xx or a renderer
 * hiccup are genuinely transient.
 *
 * ACCESS_DENIED is deliberately PERMANENT: a 401/403/paywall/robots refusal is
 * the site saying no, and retrying it would be exactly the "work around the
 * access restriction" behaviour this feature must not have.
 */
const RETRYABLE: ReadonlySet<LinkFailureCode> = new Set([
  LinkFailureCode.FETCH_TIMEOUT,
  LinkFailureCode.UPSTREAM_ERROR,
  LinkFailureCode.RENDER_FAILED,
  LinkFailureCode.INDEXING_FAILED,
]);

export function linkFailureIsRetryable(code: LinkFailureCode): boolean {
  return RETRYABLE.has(code);
}
