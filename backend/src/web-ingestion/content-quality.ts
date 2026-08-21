/**
 * Is what we extracted actually evidence about a person?
 *
 * Embedding meaningless text is worse than embedding nothing: a chunk of
 * "Enable JavaScript to continue" sits in the candidate's evidence forever,
 * matches nothing useful, dilutes retrieval, and can surface as a citation
 * under a recruiter's question. So a page must clear a bar before it is
 * indexed, and a page that does not clear it fails with an honest reason the
 * candidate can act on.
 *
 * This is also the gate that decides whether the heavier JS-render fallback is
 * worth attempting at all — the point of the two-stage design is that almost
 * every page passes here and a browser is never started.
 */

import { countWords } from './html-extract';
import { WEB_INGESTION_LIMITS } from './web-ingestion.limits';

export type QualityVerdict =
  { ok: true } | { ok: false; reason: QualityFailure };

export type QualityFailure =
  | 'too-short'
  | 'too-few-words'
  | 'javascript-shell'
  | 'access-wall'
  | 'error-page'
  | 'boilerplate-only';

/**
 * Phrases that mean the response body is not the page. Matched against the
 * first stretch of text only, where such notices live — a portfolio that
 * happens to describe building a login page must not be rejected for the word
 * "sign in" appearing halfway down.
 */
const SHELL_MARKERS: [QualityFailure, RegExp][] = [
  [
    'javascript-shell',
    /\b(enable javascript|javascript is (required|disabled)|you need to enable javascript|this app requires javascript|loading\.{3})\b/i,
  ],
  [
    'access-wall',
    /\b(sign in to continue|log ?in to (view|continue|see)|create an account to|subscribe to (read|continue)|you must be logged in|access denied|verify you are (a )?human|checking your browser|captcha|cloudflare)\b/i,
  ],
  [
    'error-page',
    /\b(404 not found|page not found|this page (does ?n[o']t exist|could not be found)|403 forbidden|500 internal server error|service unavailable|site can[' ]?t be reached)\b/i,
  ],
];

const MARKER_WINDOW_CHARS = 600;

export function assessContentQuality(
  sections: {
    text: string;
  }[],
): QualityVerdict {
  const joined = sections
    .map((section) => section.text)
    .join('\n')
    .trim();

  if (joined.length < WEB_INGESTION_LIMITS.minMeaningfulChars) {
    // Distinguish "there is nothing" from "there is a shell telling us why",
    // because the two need different advice — and different next steps
    // (a shell is exactly what the render fallback exists for).
    const marker = findMarker(joined);
    return { ok: false, reason: marker ?? 'too-short' };
  }

  const words = countWords(joined);
  if (words < WEB_INGESTION_LIMITS.minMeaningfulWords) {
    return { ok: false, reason: 'too-few-words' };
  }

  const marker = findMarker(joined);
  if (marker) {
    // A real page that merely mentions one of these phrases is long and
    // varied; a wall is short and repetitive. Length is the discriminator.
    if (joined.length < 1_200) return { ok: false, reason: marker };
  }

  // Navigation that survived extraction reads as a handful of one- and
  // two-word lines repeated: lots of lines, almost no sentences.
  const lines = joined.split('\n').filter((line) => line.trim().length > 0);
  const sentenceish = lines.filter(
    (line) => countWords(line) >= 8 || /[.!?]/.test(line),
  ).length;
  if (lines.length >= 8 && sentenceish === 0) {
    return { ok: false, reason: 'boilerplate-only' };
  }

  return { ok: true };
}

/**
 * True when a render fallback could plausibly change the outcome.
 *
 * A JS shell can. A login wall, a 404 or a genuinely thin page cannot — and
 * attempting to render an access wall would be working around it, which this
 * feature must never do.
 */
export function isRenderable(reason: QualityFailure): boolean {
  return (
    reason === 'javascript-shell' ||
    reason === 'too-short' ||
    reason === 'too-few-words' ||
    reason === 'boilerplate-only'
  );
}

function findMarker(text: string): QualityFailure | null {
  const window = text.slice(0, MARKER_WINDOW_CHARS);
  for (const [failure, pattern] of SHELL_MARKERS) {
    if (pattern.test(window)) return failure;
  }
  return null;
}
