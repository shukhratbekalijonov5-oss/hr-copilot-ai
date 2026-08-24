import { buildNormalizedIdentity } from '../web-ingestion/url-policy';
import type { NormalizedExternalJobInput } from './external-job.contract';

/**
 * When two URLs point at the same job application.
 *
 * ## Why this is the load-bearing dedupe signal
 *
 * Four ATS providers produced ZERO cross-provider merges, and that was the
 * correct answer: employers buy one ATS. The duplicate that actually occurs is
 * a company's own careers page and the ATS behind it — and those two
 * observations agree on almost nothing a fingerprint can use. The company page
 * says "Linear", the board says "linear"; the page says "North America", the
 * board says `addressCountry: USA`; the page states no employment type at all.
 *
 * What they do agree on, exactly, is the apply URL, because it is the same
 * form. So URL identity is not a tie-breaker here, it is the evidence.
 *
 * ## Conservative, on purpose
 *
 * The canonical form is `buildNormalizedIdentity`, the same one candidate
 * links are deduplicated by — reused rather than reimplemented, because a
 * second URL canonicalizer is a second set of rules to keep in agreement, and
 * the day they disagree is the day two jobs merge that should not have.
 *
 * It drops what carries no meaning — scheme, host case, `www.`, a default
 * port, a fragment, a trailing slash, known tracking parameters — and sorts
 * what remains. It keeps everything else.
 *
 * ### The query-string rule, spelled out
 *
 * Query parameters are where over-normalizing becomes a lost job. Figma's
 * careers page links to `…/figma/jobs/5220003004?gh_jid=5220003004`: strip
 * "unimportant-looking" parameters wholesale and `gh_jid` — which IS the
 * Greenhouse requisition id — goes with them. So only parameters that are
 * *known* to name a marketing campaign are dropped (`utm_*`, `gclid`,
 * `fbclid`, `mc_cid`, …), and a parameter this code does not recognize is
 * assumed to select content. Under-normalizing costs a missed merge, which a
 * later observation can fix; over-normalizing merges two live requisitions
 * into one and hides a job nobody can tell is missing.
 *
 * ### Path case is preserved
 *
 * RFC 3986 makes the path case-sensitive, and the identity respects that even
 * though a real case was found where it costs a merge: Linear publishes
 * `jobs.ashbyhq.com/Linear/{id}` on its careers page while the Ashby API,
 * queried with the configured lowercase board name, returns
 * `jobs.ashbyhq.com/linear/{id}` for the same posting. Folding path case would
 * merge those — and would also merge any two genuinely distinct paths on the
 * many servers where case matters. The pair is instead recorded as POSSIBLE
 * and left unmerged, which is what that tier is for.
 */

/** The canonical identity of one URL, or null if it is not a usable URL. */
export function urlIdentity(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  const identity = buildNormalizedIdentity(parsed);
  return identity || null;
}

/**
 * Every identity one sighting claims — its listing URL and its apply URL.
 *
 * Both, because providers disagree about which is which. Ashby's `jobUrl` is
 * the posting and `applyUrl` is that URL plus `/application`; Greenhouse uses
 * one URL for both; a company careers page states its OWN page as the listing
 * and the ATS link as the apply target. A company page that links to Ashby's
 * `jobUrl` must still match the Ashby sighting that stored `applyUrl` as its
 * canonical, and it only does if both sides publish both.
 */
export function urlIdentitiesOf(
  input: Pick<NormalizedExternalJobInput, 'sourceUrl' | 'originalUrl'>,
): string[] {
  const keys = new Set<string>();
  for (const url of [input.sourceUrl, input.originalUrl]) {
    const identity = urlIdentity(url);
    if (identity) keys.add(identity);
  }
  return [...keys];
}

/**
 * Whether two identities differ ONLY in letter case.
 *
 * Not a merge rule — a REPORTING one. It exists so the Linear case above is
 * recorded as "these look like the same posting under a different path case"
 * rather than silently filed with genuinely unrelated near-misses, which is
 * the difference between a limitation someone can act on and one nobody knows
 * about.
 */
export function differsOnlyByCase(left: string, right: string): boolean {
  return left !== right && left.toLowerCase() === right.toLowerCase();
}
