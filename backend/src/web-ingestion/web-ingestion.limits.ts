/**
 * Every bound on candidate-supplied web ingestion, in one place.
 *
 * A candidate's URL points at a machine nobody here controls. It may hang, it
 * may stream forever, it may redirect in a circle, it may be a 400 MB page of
 * generated text. None of that may consume an unbounded amount of this
 * service's time, memory, sockets or embedding budget, so every stage has a
 * ceiling and the ceilings live together where they can be reviewed as a set.
 *
 * These are deliberately unrelated to MAX_FILE_SIZE_BYTES (50 MB). An uploaded
 * file is a deliberate act by a person who waited for it; a web page is a side
 * effect of pasting a link, and 50 MB of HTML is never legitimate portfolio
 * evidence.
 */
export const WEB_INGESTION_LIMITS = {
  /** TCP connect + TLS. A host that cannot answer this fast is not going to. */
  connectTimeoutMs: 5_000,
  /** One HTTP request, headers to last byte. */
  requestTimeoutMs: 10_000,
  /**
   * The whole link: every page, every redirect, plus any render fallback.
   * Bounds the worst case a single queue job can occupy a worker for.
   */
  totalBudgetMs: 45_000,

  /** Per response. Aborted mid-stream the moment it is exceeded. */
  maxResponseBytes: 2 * 1024 * 1024,
  /**
   * Per fetched PAGE, overriding maxResponseBytes for the documents this
   * pipeline exists to read. A modern single-file SPA build routinely ships
   * megabytes of inline JavaScript around a few kilobytes of perfectly good
   * static markup; refusing the whole page over bundle weight throws away
   * real evidence (the extractor keeps at most maxExtractedChars of TEXT and
   * drops every script byte, so the big buffer lives only for the moments
   * between fetch and extraction). Anything beyond this is genuinely
   * excessive and still fails as CONTENT_TOO_LARGE.
   */
  maxPageBytes: 10 * 1024 * 1024,
  /** Per hop chain. A redirect loop dies here rather than at the socket limit. */
  maxRedirects: 3,

  /**
   * Pages fetched per link: the submitted page plus at most 3 same-origin
   * professional subpages. This is a bounded evidence source, not a crawl.
   */
  maxPagesPerLink: 4,
  /** robots.txt is fetched once per link and is not counted as a page. */
  maxRobotsBytes: 64 * 1024,

  /**
   * Extracted text kept per link, across all its pages. ~30k characters is
   * roughly 75 chunks at the configured 400-char target — enough for a real
   * portfolio, far short of letting one verbose site dominate a candidate's
   * evidence (see the AI service's per-source retrieval cap).
   */
  maxExtractedChars: 30_000,
  /** Per section, so one enormous <main> cannot eat the whole budget. */
  maxSectionChars: 6_000,
  /** Below this, the page is not usable evidence — see content-quality.ts. */
  minMeaningfulChars: 200,
  minMeaningfulWords: 20,

  /** Headless render, when the fallback is enabled at all. */
  renderTimeoutMs: 8_000,

  /** Sent on every request. Honest about who is asking and why. */
  userAgent:
    'HRCopilotLinkBot/1.0 (+candidate-submitted professional link; respects robots.txt)',
} as const;

/**
 * Ports we will connect to. Restricting to the two web ports means a submitted
 * URL cannot be used to probe or reach a service on an unusual port even at a
 * genuinely public address — and no real portfolio is served anywhere else.
 */
export const ALLOWED_URL_PORTS = new Set([80, 443]);

/** The only two schemes that exist as far as this feature is concerned. */
export const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Response content types we know how to turn into evidence. Anything else
 * (images, video, archives, executables, PDFs served over the web) is refused
 * cleanly rather than guessed at.
 */
export const SUPPORTED_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
]);
