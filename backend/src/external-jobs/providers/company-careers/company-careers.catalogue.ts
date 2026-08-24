import { Logger } from '@nestjs/common';
import type {
  CareersAccessDecision,
  CompanyCareerSource,
} from './company-careers.types';

/**
 * The company careers sources this deployment is allowed to read.
 *
 * ## Why a code catalogue and not a URL in the environment
 *
 * Every other provider takes a tenant SLUG from configuration and pastes it
 * into a fixed vendor URL, so the worst a bad value can do is 404. A company
 * careers source is a whole URL, on a host nobody vetted, and an environment
 * variable that reaches `fetch` is an SSRF primitive on a six-hour timer —
 * with the request originating inside the network the metadata endpoint lives
 * in.
 *
 * So configuration selects from this list by ID and cannot add to it:
 *
 *   EXTERNAL_COMPANY_CAREERS_SOURCES=vercel-careers,linear-careers
 *
 * An id that is not here is dropped with a warning. A URL in that variable is
 * not a URL, it is an unknown id. Enabling a new company means a code change
 * that goes through review, which is exactly the weight the decision deserves:
 * someone has to look at the site's robots rules and say whether we may read
 * it.
 *
 * ## Every entry records its access review
 *
 * Including the ones that are switched off. A rejected source with the reason
 * attached is worth more than a deleted one: without it the next person
 * researches Gopuff again, gets the same Cloudflare challenge, and has to
 * work out for themselves that the answer is "no" rather than "try harder".
 */

const REVIEWED = '2026-08-24';

function decision(
  parts: Omit<CareersAccessDecision, 'reviewedOn'>,
): CareersAccessDecision {
  return { reviewedOn: REVIEWED, ...parts };
}

/**
 * Vercel — enumerated from the company's own sitemap.
 *
 * `vercel.com/careers` renders its list from a React server-component payload
 * and contains no job anchors at all, so the page cannot be enumerated from
 * its HTML. The sitemap, which robots.txt advertises, does list career pages,
 * and each of those pages is ordinary static HTML: `og:title`, `og:url`, and
 * exactly one link to `job-boards.greenhouse.io/vercel/jobs/{id}`.
 *
 * The sitemap holds 22 career URLs against 83 open roles, so this source can
 * NEVER be treated as a complete listing — `indexIsComplete: false` — and it
 * therefore cannot retire anything. It is a provenance source, not a census.
 *
 * It also produces the catalogue's sharpest dedupe case: three of those URLs
 * (`software-engineer-accounts-…`, `software-engineer-accounts-us-…`,
 * `software-engineer-backend-us-…`) carry the SAME Greenhouse requisition
 * 5430088004. Three company pages, one job.
 *
 * ## Switched OFF after the first live run
 *
 * The Apply button is not an `<a href>`. It is rendered client-side from the
 * hydration payload, so a deterministic reader sees a page with a title and
 * nothing else — and 22 of those became 22 duplicate rows of jobs the
 * Greenhouse board already held, with no apply link, no description and no
 * location. `statesMoreThanItsOwnLink` refuses them now, which means every
 * sweep spends 22 requests to ingest zero jobs.
 *
 * So it is disabled rather than left running: reading a company's site 88
 * times a day to learn nothing is neither useful nor courteous. The entry
 * stays because the finding is worth keeping and because the day Vercel puts
 * that link in markup, or publishes JobPosting JSON-LD, this becomes a
 * one-word change.
 */
const VERCEL_CAREERS: CompanyCareerSource = {
  sourceId: 'vercel-careers',
  companyLabel: 'Vercel',
  companyWebsiteUrl: 'https://vercel.com',
  /*
   * `/sitemap.xml` 301s to `/crawled-sitemap.xml`, so the redirect target is
   * named directly. The per-hop path allowlist caught this on the first live
   * run — a redirect to another PATH on an allowed host is still a redirect
   * the source did not declare — and following it silently would have made
   * the allowlist mean "any path on this host".
   */
  indexUrl: 'https://vercel.com/crawled-sitemap.xml',
  allowedHosts: ['vercel.com'],
  allowedPathPrefixes: ['/crawled-sitemap.xml', '/sitemap.xml', '/careers'],
  applyHosts: ['job-boards.greenhouse.io', 'boards.greenhouse.io'],
  index: 'SITEMAP',
  detail: 'HTML_META',
  jobPathPattern: /^\/careers\/[A-Za-z0-9][A-Za-z0-9-]{0,199}$/,
  indexIsComplete: false,
  maxJobsPerSync: 100,
  maxDetailRequests: 60,
  minRequestIntervalMs: 1_500,
  expectedAtsProvider: 'GREENHOUSE',
  access: decision({
    robots:
      'robots.txt allows /careers for the wildcard agent (only /api/, /oauth, ' +
      '/signup and similar are disallowed) and advertises /sitemap.xml, which ' +
      '301s to the /crawled-sitemap.xml read here',
    rendering:
      'index is React server-component payload with no job anchors; job pages ' +
      'are static HTML with og:title, og:url and one Greenhouse apply link',
    verdict:
      'NOT enabled: readable and permitted, but the Apply link exists only in ' +
      'the hydration payload, so every page yields a bare title that could ' +
      'only become a duplicate of the Greenhouse posting already ingested',
  }),
  enabled: false,
};

/**
 * Linear — a genuinely static, company-authored careers list.
 *
 * The strongest source found: `linear.app/careers` is server-rendered HTML
 * with real `<a href="/careers/{uuid}">` rows carrying the company's own
 * wording for the title and location ("North America", which no ATS field
 * contains), and each job has its own page on linear.app that links to Ashby.
 *
 * `indexIsComplete` is nevertheless false, and the reason is a measurement
 * rather than caution: the page anchors 25 jobs while the Ashby board lists
 * 32, because seven titles are open TWICE and the page renders one row per
 * title. A posting missing from this index has not necessarily stopped being
 * published — it may be the second opening under a title that is still shown —
 * so absence here is not evidence.
 *
 * ## Switched OFF after the first live run, for the same reason as Vercel
 *
 * The Ashby link is in the hydration payload, not in an anchor, so 25 pages
 * yielded 25 bare titles — unable to merge with the Ashby sightings of the
 * same roles, and able to become nothing but duplicates.
 *
 * The locations the index states are real and company-authored, and still do
 * not help: they are "North America" (16), "Europe, North America" (6),
 * "Europe" and "London". Continents are not countries, and the schema holds a
 * country and a city. Turning "North America" into US — or into anything —
 * would be the guessing this product refuses everywhere else, and Ashby's own
 * live data already forced the same refusal on "European Union".
 */
const LINEAR_CAREERS: CompanyCareerSource = {
  sourceId: 'linear-careers',
  companyLabel: 'Linear',
  companyWebsiteUrl: 'https://linear.app',
  indexUrl: 'https://linear.app/careers',
  allowedHosts: ['linear.app'],
  allowedPathPrefixes: ['/careers'],
  applyHosts: ['jobs.ashbyhq.com'],
  index: 'ANCHOR_LIST',
  detail: 'HTML_META',
  jobPathPattern:
    /^\/careers\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  titleSuffixes: [' - Linear Careers'],
  indexIsComplete: false,
  maxJobsPerSync: 100,
  maxDetailRequests: 60,
  minRequestIntervalMs: 1_500,
  expectedAtsProvider: 'ASHBY',
  access: decision({
    robots:
      'robots.txt disallows only /api/ and /cdn-cgi/; /careers is allowed',
    rendering:
      'static HTML index with real job anchors carrying title and location; ' +
      'job pages are static HTML with og:title and an Ashby apply link',
    verdict:
      'NOT enabled: readable and permitted, but the Ashby link exists only in ' +
      'the hydration payload and the stated locations are continents, so ' +
      'every page yields a bare title that could only become a duplicate',
  }),
  enabled: false,
};

/**
 * Figma — reviewed, deliberately NOT enabled.
 *
 * Technically the easiest source in the catalogue: 164 static anchors straight
 * to `boards.greenhouse.io/figma/jobs/{id}?gh_jid={id}`, no rendering needed.
 *
 * It is off because figma.com/robots.txt names GPTBot, ClaudeBot, CCBot,
 * cohere-ai, PerplexityBot, Google-Extended and amazon-kendra and gives every
 * one of them `Disallow: /`. Our agent is none of those, and the wildcard group
 * does allow /careers — so a literal reading permits the fetch. But the
 * literal reading is not the only thing that matters: the site has enumerated
 * the AI-assistant crawlers it does not want, and this product reads job text
 * to feed an AI matching pipeline.
 *
 * Skipping costs nothing real. Figma's board is already ingested through the
 * official Greenhouse Job Board API, which is public, authorized and gives the
 * same postings; all that is given up is the company-page provenance layer.
 * Paying that price to respect an unambiguous signal is the right trade.
 */
const FIGMA_CAREERS: CompanyCareerSource = {
  sourceId: 'figma-careers',
  companyLabel: 'Figma',
  companyWebsiteUrl: 'https://www.figma.com',
  indexUrl: 'https://www.figma.com/careers/',
  allowedHosts: ['figma.com'],
  allowedPathPrefixes: ['/careers'],
  applyHosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io'],
  index: 'ATS_LINK_INDEX',
  detail: 'NONE',
  jobPathPattern: /^\/careers\/?$/,
  indexIsComplete: false,
  maxJobsPerSync: 200,
  maxDetailRequests: 0,
  minRequestIntervalMs: 2_000,
  expectedAtsProvider: 'GREENHOUSE',
  access: decision({
    robots:
      'wildcard group allows /careers, but the file separately gives ' +
      'Disallow: / to GPTBot, ClaudeBot, CCBot, cohere-ai, PerplexityBot, ' +
      'Google-Extended and amazon-kendra',
    rendering:
      'static HTML with 164 direct Greenhouse anchors carrying ?gh_jid={id}',
    verdict:
      'NOT enabled: the site has explicitly refused AI-assistant crawlers and ' +
      'these postings are already ingested through the official Greenhouse API',
  }),
  enabled: false,
};

/**
 * Ramp — reviewed, not enabled, and the clearest example of what a company
 * careers source must NOT be.
 *
 * `ramp.com/careers` has no job anchors and no company-owned job pages
 * (`/careers/{id}` is a 404). Its job data exists only inside a React
 * server-component payload — which is a verbatim copy of the Ashby posting
 * API response, `id`, `secondaryLocations`, `workplaceType` and all.
 *
 * Reading it would mean two separate mistakes at once: parsing an undocumented
 * wire format that changes without notice, and re-ingesting the Ashby payload
 * a second time under a different provider name. The second is worse. It would
 * manufacture provenance — a "company careers" sighting that observed nothing
 * the ATS had not already told us — and every duplicate-source count in this
 * system would become a number that means nothing.
 */
const RAMP_CAREERS: CompanyCareerSource = {
  sourceId: 'ramp-careers',
  companyLabel: 'Ramp',
  companyWebsiteUrl: 'https://ramp.com',
  indexUrl: 'https://ramp.com/careers',
  allowedHosts: ['ramp.com'],
  allowedPathPrefixes: ['/careers'],
  applyHosts: ['jobs.ashbyhq.com'],
  index: 'ANCHOR_LIST',
  detail: 'NONE',
  jobPathPattern: /^\/careers\/[A-Za-z0-9-]{1,200}$/,
  indexIsComplete: false,
  maxJobsPerSync: 100,
  maxDetailRequests: 0,
  minRequestIntervalMs: 2_000,
  expectedAtsProvider: 'ASHBY',
  access: decision({
    robots: 'robots.txt allows /careers',
    rendering:
      'no job anchors and no company-owned job pages; the list exists only as ' +
      'a verbatim copy of the Ashby posting API inside an RSC payload',
    verdict:
      'NOT enabled: no independent company observation exists to make, and ' +
      'reading it would re-ingest the ATS payload as a second provenance source',
  }),
  enabled: false,
};

/** Everything this deployment knows how to read, enabled or not. */
export const COMPANY_CAREERS_CATALOGUE: readonly CompanyCareerSource[] = [
  VERCEL_CAREERS,
  LINEAR_CAREERS,
  FIGMA_CAREERS,
  RAMP_CAREERS,
];

/**
 * Companies whose careers pages were reviewed and found unusable.
 *
 * Kept because a negative result is a result. Nothing reads this at runtime;
 * it exists so the next person to ask "why isn't Discord in here" gets an
 * answer instead of repeating the work.
 */
export const REVIEWED_AND_REJECTED: readonly {
  company: string;
  url: string;
  finding: string;
}[] = [
  {
    company: 'GitLab',
    url: 'https://about.gitlab.com/jobs/all-jobs/',
    finding:
      'robots allows the path, but the list is a Nuxt _payload.json rather ' +
      'than markup; the only JSON-LD on the page is WebSite/Organization',
  },
  {
    company: 'Discord',
    url: 'https://discord.com/careers',
    finding:
      'robots allows /careers; the page has one "#all-jobs" anchor and no ' +
      'job links, and its JSON-LD is Article plus BreadcrumbList',
  },
  {
    company: 'Vanta',
    url: 'https://www.vanta.com/careers',
    finding:
      'redirects to /company/careers, renders its list client-side and ' +
      'exposes no ATS links in HTML; robots also disallows /careers/paralegal ' +
      'specifically, so any future source here must be path-aware',
  },
  {
    company: 'Ashby',
    url: 'https://www.ashbyhq.com/careers',
    finding: 'client-rendered; one self-referential /careers anchor, no jobs',
  },
  {
    company: 'Gopuff',
    url: 'https://www.gopuff.com',
    finding:
      'a Cloudflare managed challenge answers robots.txt itself; solving it ' +
      'is the anti-bot bypass this product does not do',
  },
  {
    company: 'Ro',
    url: 'https://ro.co',
    finding: 'robots.txt returns 403 to a plain client; refusal is respected',
  },
  {
    company: 'Match Group',
    url: 'https://mtch.com',
    finding:
      'robots allows with Crawl-delay: 10, but the corporate site carries no ' +
      'job listing — the Lever site is the only publication path',
  },
];

/**
 * Which catalogue entries this deployment runs.
 *
 * The variable holds IDs. An unknown id is dropped with a warning rather than
 * being treated as anything else — and specifically, a URL pasted in here is
 * an unknown id and nothing more, which is the property that keeps an
 * environment variable from ever choosing a fetch destination.
 */
export function parseCompanyCareersConfig(
  raw: string | undefined,
  options: {
    logger?: Logger;
    /**
     * The approved list to select from. Defaults to the real catalogue; a
     * caller passes one only in tests, so that the SELECTION rules can be
     * proven independently of which companies happen to be switched on.
     */
    catalogue?: readonly CompanyCareerSource[];
  } = {},
): CompanyCareerSource[] {
  if (!raw) return [];
  const byId = new Map(
    (options.catalogue ?? COMPANY_CAREERS_CATALOGUE).map((source) => [
      source.sourceId,
      source,
    ]),
  );
  const chosen: CompanyCareerSource[] = [];
  const seen = new Set<string>();

  for (const entry of raw.split(',')) {
    const id = entry.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const source = byId.get(id);
    if (!source) {
      // The value is not echoed: it is untrusted input and this is a log file.
      options.logger?.warn(
        `Ignoring an unknown company careers source id (${id.length} chars); ` +
          `known ids: ${[...byId.keys()].join(', ')}`,
      );
      continue;
    }
    if (!source.enabled) {
      options.logger?.warn(
        `Company careers source ${source.sourceId} is configured but its ` +
          `access review says: ${source.access.verdict}`,
      );
      continue;
    }
    chosen.push(source);
  }
  return chosen;
}

/**
 * Whether this source may fetch a URL.
 *
 * Host AND path, both checked after the URL has been parsed — a prefix test
 * against the raw string would pass `https://vercel.com.evil.test/careers`.
 * The host rule is exact-or-true-subdomain for the same reason it is
 * everywhere else in this module: `endsWith` accepts a domain an attacker can
 * register.
 */
export function isFetchableForSource(
  source: CompanyCareerSource,
  url: URL,
): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  const hostAllowed = source.allowedHosts.some((allowed) => {
    const candidate = allowed.toLowerCase();
    return host === candidate || host.endsWith(`.${candidate}`);
  });
  if (!hostAllowed) return false;

  return source.allowedPathPrefixes.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(prefix),
  );
}

/** Whether an apply link may be STORED for this source. Never fetched. */
export function isStorableApplyUrl(
  source: CompanyCareerSource,
  url: URL,
): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return [...source.applyHosts, ...source.allowedHosts].some((allowed) => {
    const candidate = allowed.toLowerCase();
    return host === candidate || host.endsWith(`.${candidate}`);
  });
}
