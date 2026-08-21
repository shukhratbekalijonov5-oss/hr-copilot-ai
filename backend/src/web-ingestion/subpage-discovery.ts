/**
 * Which additional pages of a submitted site may be read.
 *
 * A portfolio's home page is often a hero image and a tagline; the actual
 * evidence lives on /projects and /about. Reading those makes the source
 * useful. Reading *everything* would turn one pasted link into a crawl of a
 * stranger's website, which is neither wanted nor defensible.
 *
 * The rules, all of them:
 *   - same origin as the submitted page, always;
 *   - the path must look like a professional section, by name;
 *   - depth ≤ 2 path segments, no query strings, no fragments, no files;
 *   - at most 3 extra pages, discovered from the submitted page ONLY (a
 *     discovered page never contributes further links — that is the difference
 *     between "a couple of subpages" and a spider).
 *
 * Cross-origin links are dropped upstream by the extractor. A candidate who
 * wants their GitHub read adds GitHub as one of their three links; that is an
 * explicit act of consent, and it is the only way an external site becomes
 * evidence.
 */

import { WEB_INGESTION_LIMITS } from './web-ingestion.limits';

/**
 * Path names that mean "this is where the professional content is". Route
 * names are NOT assumed to exist — this filters links the page really has.
 */
const PROFESSIONAL_PATHS =
  /^(about(-me)?|bio|profile|projects?|work|works|portfolio|case-studies|experience|resume|cv|skills|services|writing|blog)$/i;

export function discoverSubpages(
  pageUrl: string,
  links: string[],
  limit = WEB_INGESTION_LIMITS.maxPagesPerLink - 1,
): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }

  // GitHub is the one host where "same origin, professional-looking path" is
  // the wrong heuristic: /user?tab=repositories, /user/repo/tree/... and every
  // file in every repository match nothing useful and multiply without bound.
  // The profile README and repository description are on the submitted page.
  const host = base.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'github.com') return [];

  const seen = new Set<string>([canonical(base)]);
  const found: string[] = [];

  for (const link of links) {
    if (found.length >= limit) break;

    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    if (url.search) continue;

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0 || segments.length > 2) continue;
    // A link to a file (.pdf, .zip, .png) is not a page of this site.
    if (/\.[a-z0-9]{2,5}$/i.test(segments[segments.length - 1])) continue;
    if (!segments.some((segment) => PROFESSIONAL_PATHS.test(segment))) continue;

    url.hash = '';
    const key = canonical(url);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(url.toString());
  }

  return found;
}

function canonical(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`.toLowerCase();
}
