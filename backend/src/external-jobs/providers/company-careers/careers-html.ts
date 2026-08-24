import { EXTERNAL_JOB_LIMITS } from '../../external-job.limits';
import { decodeEntities, text } from '../../normalize';

/**
 * Reading a careers page without guessing what it means.
 *
 * ## The rule every function here follows
 *
 * Only standardized, document-level structure is read: `<a href>`, `og:*`,
 * `<title>`, `<h1>`, and `<loc>` in a sitemap. Nothing here looks at a class
 * name, and that is not stylistic — Linear's job rows carry
 * `class="X2WvJq_jobRow"`, a content hash regenerated on every deploy. A
 * selector built on it works until Tuesday and then silently returns zero jobs,
 * which on a complete source would look exactly like a company that stopped
 * hiring.
 *
 * ## And no LLM
 *
 * There is no path from this module to Gemini or any other model. Extraction
 * is deterministic and auditable: the same page always yields the same jobs,
 * and when it yields the wrong ones the reason is a rule someone can read.
 * "Ask a model what the jobs are" would make the catalogue's contents
 * unreproducible and non-explainable, and merging or retiring jobs on that
 * basis is the thing this architecture exists to refuse.
 */

/** Anchors read from one page. A careers index is hundreds, not millions. */
const MAX_ANCHORS = 5_000;
const ANCHOR = /<a\b([^>]*)>([\s\S]{0,2000}?)<\/a>/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const META = /<meta\b[^>]*>/gi;
const ATTR = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');

export interface PageAnchor {
  /** Absolute URL, resolved against the page it was found on. */
  href: string;
  /** The anchor's visible text, tags removed and entities decoded. */
  label: string;
  /** Each text run inside the anchor, in order. Titles and locations. */
  parts: string[];
}

/**
 * Every anchor on a page, resolved to absolute URLs.
 *
 * `parts` exists because a job row is usually two spans — the title and the
 * location — and the ORDER of the text runs is real document structure, while
 * the elements holding them are not. Reading the first run as the title is a
 * declared per-source assumption; reading `.jobTitle` would be a guess with a
 * shelf life.
 */
export function readAnchors(html: string, baseUrl: string): PageAnchor[] {
  const anchors: PageAnchor[] = [];
  ANCHOR.lastIndex = 0;
  for (
    let match = ANCHOR.exec(html);
    match !== null && anchors.length < MAX_ANCHORS;
    match = ANCHOR.exec(html)
  ) {
    const href = firstGroup(HREF.exec(match[1]));
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(decodeEntities(href.trim()), baseUrl).toString();
    } catch {
      continue;
    }
    const parts = textRuns(match[2]);
    anchors.push({ href: absolute, label: parts.join(' ').trim(), parts });
  }
  return anchors;
}

/** The text runs inside a fragment, tags removed, in document order. */
function textRuns(fragment: string): string[] {
  return fragment
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<[^>]*>/)
    .map((run) => decodeEntities(run).replace(/\s+/g, ' ').trim())
    .filter((run) => run.length > 0);
}

/**
 * Document metadata: `og:*`, `twitter:*` and named meta tags.
 *
 * OpenGraph is used rather than invented selectors because it is a published
 * vocabulary a site fills in deliberately, for consumers it does not control.
 * That makes it the closest thing a plain HTML page has to a contract.
 */
export function readMeta(html: string): Map<string, string> {
  const found = new Map<string, string>();
  const property = ATTR('property');
  const name = ATTR('name');
  const content = ATTR('content');

  META.lastIndex = 0;
  for (let match = META.exec(html); match !== null; match = META.exec(html)) {
    const tag = match[0];
    const key = firstGroup(property.exec(tag)) ?? firstGroup(name.exec(tag));
    const value = firstGroup(content.exec(tag));
    if (!key || value === null) continue;
    const normalized = key.trim().toLowerCase();
    if (!found.has(normalized)) {
      found.set(normalized, decodeEntities(value).replace(/\s+/g, ' ').trim());
    }
  }
  return found;
}

/** The page's `<title>`, or null. */
export function readTitleTag(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]{0,1000}?)<\/title>/i.exec(html);
  if (!match) return null;
  return text(plainText(match[1]), 1_000);
}

/** The first `<h1>`, tags removed. Linear writes "Account Executive,<br/> …". */
export function readHeading(html: string): string | null {
  const match = /<h1\b[^>]*>([\s\S]{0,2000}?)<\/h1>/i.exec(html);
  if (!match) return null;
  return text(plainText(match[1]), 1_000);
}

/**
 * A fragment as text.
 *
 * Script and style SUBTREES go first, contents included. Removing only the
 * tags would leave `alert(1)` sitting in a job title — harmless as stored
 * text, and exactly the kind of debris that makes a candidate distrust a
 * listing.
 */
function plainText(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  );
}

/**
 * A job title from a page's metadata, with the site's boilerplate removed.
 *
 * `og:title` first: it is the value the site chose to represent the page to
 * other systems, so it is the least likely to carry navigation furniture. The
 * `<title>` tag and `<h1>` follow.
 *
 * Suffix stripping is declared per source ("` - Linear Careers`") rather than
 * pattern-matched, because a rule like "drop everything after the last dash"
 * turns "Engineer - Backend" into "Engineer".
 */
export function readJobTitle(
  html: string,
  suffixes: readonly string[] = [],
): string | null {
  const meta = readMeta(html);
  const raw =
    meta.get('og:title') ??
    meta.get('twitter:title') ??
    readTitleTag(html) ??
    readHeading(html);
  if (!raw) return null;

  let title = raw;
  for (const suffix of suffixes) {
    if (title.toLowerCase().endsWith(suffix.toLowerCase())) {
      title = title.slice(0, title.length - suffix.length);
    }
  }
  return text(title, EXTERNAL_JOB_LIMITS.maxTitleLength);
}

/** The URL a page says it canonically is: `og:url`, then `<link rel=canonical>`. */
export function readCanonicalUrl(html: string, baseUrl: string): string | null {
  const meta = readMeta(html);
  const stated =
    meta.get('og:url') ??
    firstGroup(
      /<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i.exec(html)
        ? ATTR('href').exec(
            /<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i.exec(html)![0],
          )
        : null,
    );
  if (!stated) return null;
  try {
    return new URL(stated, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Every `<loc>` in a sitemap, absolute.
 *
 * A deliberately small XML reader rather than a parser dependency: the
 * sitemaps.org format's whole content model here is `<loc>` inside `<url>`,
 * and everything else in the document is ignored. No entity expansion, no
 * DTD, no external references — an XML parser pointed at a third-party
 * document is an XXE waiting for the one server that still resolves entities.
 */
export function readSitemapLocations(xml: string, baseUrl: string): string[] {
  const locations: string[] = [];
  const LOC = /<loc\b[^>]*>([\s\S]{0,4000}?)<\/loc>/gi;
  LOC.lastIndex = 0;
  for (
    let match = LOC.exec(xml);
    match !== null && locations.length < 50_000;
    match = LOC.exec(xml)
  ) {
    const raw = decodeEntities(
      match[1].replace(/<!\[CDATA\[|\]\]>/g, ''),
    ).trim();
    if (!raw) continue;
    try {
      locations.push(new URL(raw, baseUrl).toString());
    } catch {
      continue;
    }
  }
  return locations;
}

/** Whether a sitemap points at other sitemaps rather than at pages. */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex\b/i.test(xml);
}

function firstGroup(match: RegExpExecArray | null): string | null {
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}
