import type { ExternalProvider } from '../../../generated/prisma/enums';

/**
 * How one approved company careers source is read.
 *
 * ## Declared, never inferred
 *
 * There is no generic "figure out this careers page" path, and the absence is
 * the design. A parser that guesses at site structure is a crawler with
 * optimism attached: it works on the three sites it was written against, and
 * every other site it silently mis-reads becomes wrong job data nobody can
 * trace back to a parsing bug. So every source states how its index is
 * enumerated, how a detail page is read, and which paths it is allowed to
 * touch — and anything a source did not declare, this provider will not do.
 *
 * ## Two hosts lists, for two different questions
 *
 * `allowedHosts` is what may be FETCHED. `applyHosts` is what an apply link
 * may POINT AT and still be stored. They are separate because a careers page
 * legitimately links to an ATS this provider has no business fetching: the
 * link is data to hand a candidate, not an invitation to widen the crawl.
 */

/** How a source's list of open jobs is enumerated. */
export type CareersIndexStrategy =
  /**
   * The company's own sitemap.xml, filtered to job paths. A standardized,
   * documented format the site publishes FOR crawlers — the most respectful
   * enumeration available when a careers page renders its list in JavaScript.
   * Usually incomplete (sitemaps lag), so it rarely proves absence.
   */
  | 'SITEMAP'
  /** Real `<a href>` job links in the index page's HTML. */
  | 'ANCHOR_LIST'
  /** schema.org JobPosting objects embedded in the index page. */
  | 'JSON_LD_INDEX'
  /**
   * An index whose links go straight to the ATS, with no company-owned job
   * page in between. The company page is then evidence that the employer
   * publishes the role, and the ATS link is the identity.
   */
  | 'ATS_LINK_INDEX';

/** How one job's facts are read once its page has been fetched. */
export type CareersDetailStrategy =
  /** schema.org JobPosting on the job's own page. The preferred source. */
  | 'JSON_LD'
  /**
   * Standardized document metadata: `og:title`, `og:url`, `<title>`, `<h1>`,
   * plus the apply anchor. Deliberately NOT hashed CSS class names, which are
   * regenerated on every deploy of the sites this reads.
   */
  | 'HTML_META'
  /** The index already stated everything; no detail request is made. */
  | 'NONE';

/** Why a reviewed source is or is not enabled. Written down, not remembered. */
export interface CareersAccessDecision {
  /** ISO date the access review was performed. */
  reviewedOn: string;
  /** What robots.txt said for the relevant paths at review time. */
  robots: string;
  /** How the page serves its job content. */
  rendering: string;
  /** The decision, in one sentence. */
  verdict: string;
}

export interface CompanyCareerSource {
  /** Stable id. This — never a URL — is what configuration names. */
  sourceId: string;
  companyLabel: string;
  /** The employer's own site, as company evidence. Stated, not derived. */
  companyWebsiteUrl: string;
  /** Where enumeration starts. */
  indexUrl: string;
  /** Hosts this source may fetch. Exact host or a true subdomain. */
  allowedHosts: string[];
  /** Path prefixes on those hosts this source may fetch. */
  allowedPathPrefixes: string[];
  /** Hosts an apply link may point at and still be stored. Never fetched. */
  applyHosts: string[];
  index: CareersIndexStrategy;
  detail: CareersDetailStrategy;
  /**
   * The shape of a job path on this site, anchored.
   *
   * A code constant rather than configuration: a pattern from the environment
   * is an untrusted regular expression compiled in a worker, which is a
   * denial-of-service primitive with a scheduler attached.
   */
  jobPathPattern: RegExp;
  /**
   * Boilerplate this site appends to `og:title` ("… - Linear Careers").
   * Removed so the stored title is the role, not the page's headline.
   */
  titleSuffixes?: string[];
  /**
   * Whether a fully parsed index enumerates EVERY posting the company has
   * open. False by default and rarely true: see the catalogue for two live
   * reasons it usually is not.
   */
  indexIsComplete: boolean;
  maxJobsPerSync: number;
  maxDetailRequests: number;
  minRequestIntervalMs: number;
  /** The ATS this source is expected to hand applications to. Documentation. */
  expectedAtsProvider?: ExternalProvider;
  access: CareersAccessDecision;
  enabled: boolean;
}

/** One job as a company careers page stated it, before normalization. */
export interface CareersPageJob {
  /** The company-owned page this job was read from. */
  pageUrl: string;
  title: string | null;
  /** Where the candidate applies — usually an ATS. */
  applyUrl: string | null;
  /** Free-text location as the company wrote it, when it stated one. */
  locationText: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  additionalLocations: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  }[];
  description: string | null;
  employmentTypeRaw: string | null;
  workModeRaw: string | null;
  remoteCountriesAllowed: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriodRaw: string | null;
  validThrough: string | null;
  /**
   * schema.org `datePosted`, verbatim. May be a bare `YYYY-MM-DD`.
   *
   * Kept as the source's own string rather than parsed here: the page reader's
   * job is to report what the markup said, and deciding whether a date-only
   * value is usable belongs to `publicationDate` where the rule is stated once.
   */
  datePosted: string | null;
  companyName: string | null;
  companyWebsiteUrl: string | null;
}
