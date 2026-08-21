import { LinkFailureCode } from '../generated/prisma/enums';
import { WebIngestionError } from './web-ingestion.errors';
import { classifyAddress } from './ip-guard';
import {
  ALLOWED_URL_PORTS,
  ALLOWED_URL_PROTOCOLS,
} from './web-ingestion.limits';

/**
 * What a candidate-supplied URL is allowed to be, and what it canonically IS.
 *
 * Two separate jobs live here, and the order matters:
 *
 *  1. **Policy** (`assertFetchableUrl`) — a purely syntactic gate applied to
 *     the submitted URL *and, unchanged, to every redirect target*. It cannot
 *     be the whole defence (a hostname says nothing about the address a socket
 *     will reach) but it removes the entire class of non-HTTP schemes, odd
 *     ports, credentials-in-URL and obviously-internal names before any DNS
 *     lookup happens.
 *
 *  2. **Identity** (`normalizeUrl`) — the canonical form used to detect that
 *     two saved links are the same source. Normalization is CONSERVATIVE:
 *     scheme/host case, a default port, a fragment, a trailing slash and known
 *     tracking parameters carry no meaning, so they are dropped. A path or a
 *     real query parameter genuinely selects different content, so it is kept.
 *     Over-normalizing here would silently merge two different pages; under-
 *     normalizing lets someone fill all three slots with the same site.
 */

export interface NormalizedUrl {
  /** What the candidate typed, trimmed. Shown back to them verbatim. */
  original: string;
  /** Canonical absolute URL used for fetching. */
  href: string;
  /** Duplicate-detection identity, unique per candidate account. */
  normalized: string;
  hostname: string;
  /** Display-only classification. Never a scoring or security input. */
  detectedType: LinkDetectedType;
}

export type LinkDetectedType = 'GITHUB' | 'PORTFOLIO' | 'PROJECT' | 'WEBSITE';

/**
 * Query parameters that identify a marketing campaign, not content. Dropping
 * them means the same page shared from two places is recognised as one source.
 */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^(fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|vero_id|ref_src|ref_url)$/i,
];

/**
 * Suffixes that only ever name something inside a private network. Blocking
 * them is belt-and-braces — the address check would catch the resolution — but
 * it fails fast with an honest reason instead of a timeout.
 */
const INTERNAL_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.home.arpa',
  '.corp',
  '.private',
  '.test',
  '.example',
  '.invalid',
];

/**
 * Parses and validates a candidate-supplied URL string.
 *
 * Throws WebIngestionError with a typed code — never a raw parse error, whose
 * message can quote the input straight back into a UI.
 */
export function parseCandidateUrl(input: string): NormalizedUrl {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    throw new WebIngestionError(LinkFailureCode.INVALID_URL, 'URL is empty');
  }
  if (trimmed.length > 2048) {
    throw new WebIngestionError(
      LinkFailureCode.INVALID_URL,
      'URL exceeds 2048 characters',
    );
  }
  // Reject whitespace and control characters outright: they are how a payload
  // is smuggled past a naive parser (CR/LF header injection above all), never
  // part of a real link. The control-character range IS the point of the rule,
  // so the lint rule warning about it is disabled deliberately.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) {
    throw new WebIngestionError(
      LinkFailureCode.INVALID_URL,
      'URL contains whitespace or control characters',
    );
  }

  // A bare "portfolio.example.com" is a normal thing for a person to type.
  // Defaulting to HTTPS (never HTTP) is the safe direction: it can only
  // upgrade the request, never downgrade it.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new WebIngestionError(
      LinkFailureCode.INVALID_URL,
      'URL could not be parsed',
    );
  }

  assertFetchableUrl(url);
  return {
    original: trimmed,
    href: url.toString(),
    normalized: buildNormalizedIdentity(url),
    hostname: url.hostname.toLowerCase(),
    detectedType: detectType(url),
  };
}

/**
 * The gate every URL passes — the submitted one and each redirect target.
 *
 * Deliberately identical for both: a public site redirecting into
 * `http://169.254.169.254/latest/meta-data/` must fail exactly as if the
 * candidate had pasted it, and the only way to guarantee that is to run one
 * function over every hop (see safe-fetcher.ts).
 */
export function assertFetchableUrl(url: URL): void {
  if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) {
    // file:, ftp:, gopher:, data:, javascript:, blob: and everything else.
    throw new WebIngestionError(
      LinkFailureCode.UNSUPPORTED_PROTOCOL,
      `Protocol ${url.protocol} is not supported`,
    );
  }
  if (url.username || url.password) {
    // Credentials in a URL are both a phishing shape ("https://github.com@evil")
    // and a way to smuggle auth to an internal service.
    throw new WebIngestionError(
      LinkFailureCode.INVALID_URL,
      'URL must not contain credentials',
    );
  }

  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80;
  if (!ALLOWED_URL_PORTS.has(port)) {
    throw new WebIngestionError(
      LinkFailureCode.UNSUPPORTED_PROTOCOL,
      `Port ${port} is not supported`,
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new WebIngestionError(LinkFailureCode.INVALID_URL, 'URL has no host');
  }

  // A bracketed host is always an IPv6 literal; a dotted-quad host is IPv4.
  // Both are refused before DNS: a public professional link is addressed by
  // name, and a literal address is how the name-based checks are bypassed.
  // (Private literals are named as such so the candidate gets the honest
  // reason rather than a generic "invalid".)
  if (hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const verdict = classifyAddress(hostname);
    throw new WebIngestionError(
      verdict.allowed
        ? LinkFailureCode.INVALID_URL
        : LinkFailureCode.PRIVATE_NETWORK_URL,
      'URL must address a public host by name, not by IP',
    );
  }

  if (!hostname.includes('.')) {
    // "localhost", "intranet", "metadata" — a single-label name can only
    // resolve inside a private network or a search domain.
    throw new WebIngestionError(
      LinkFailureCode.PRIVATE_NETWORK_URL,
      'Single-label hostnames are not public',
    );
  }
  if (INTERNAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new WebIngestionError(
      LinkFailureCode.PRIVATE_NETWORK_URL,
      'Hostname is in a private-use namespace',
    );
  }
}

/** Canonical identity. See the module docstring for what is and is not dropped. */
export function buildNormalizedIdentity(url: URL): string {
  const normalized = new URL(url.toString());

  normalized.protocol = normalized.protocol.toLowerCase();
  normalized.hostname = normalized.hostname.toLowerCase();
  // `www.` is a serving convention, not a different site.
  if (normalized.hostname.startsWith('www.')) {
    normalized.hostname = normalized.hostname.slice(4);
  }
  normalized.port = '';
  // A fragment is resolved by the browser and never sent to the server, so it
  // cannot select different content for us.
  normalized.hash = '';
  normalized.username = '';
  normalized.password = '';

  for (const key of [...normalized.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      normalized.searchParams.delete(key);
    }
  }
  normalized.searchParams.sort();

  // Trailing slash: "/projects" and "/projects/" are the same resource in
  // every server this feature will meet. The root path collapses to empty.
  let pathname = normalized.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  if (pathname === '/') pathname = '';
  normalized.pathname = pathname;

  const query = normalized.searchParams.toString();
  // Scheme is excluded from the identity on purpose: http:// and https:// of
  // the same page are one source, and letting both be saved would be a free
  // extra slot.
  return `${normalized.hostname}${pathname}${query ? `?${query}` : ''}`;
}

/**
 * A short, human-readable stand-in for a URL.
 *
 * Used wherever a source needs a title and none was supplied: a bare hostname
 * reads as a source ("portfolio.example.com"), a full URL does not, and an
 * empty title would render as a blank row while a link is still being fetched.
 */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Display label only. Reliable cases only; everything else stays generic. */
function detectType(url: URL): LinkDetectedType {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'github.com' || host.endsWith('.github.io')) return 'GITHUB';
  if (/^(behance\.net|dribbble\.com|notion\.site)$/.test(host)) {
    return 'PORTFOLIO';
  }
  if (/(^|\.)(vercel\.app|netlify\.app|pages\.dev|surge\.sh)$/.test(host)) {
    return 'PROJECT';
  }
  return 'WEBSITE';
}
