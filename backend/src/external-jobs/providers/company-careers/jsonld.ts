import { EXTERNAL_JOB_LIMITS } from '../../external-job.limits';
import { plainDescription, safeUrl, text } from '../../normalize';
import { countryCodeFromName } from '../../../common/vacancy/country-names';
import type { CareersPageJob } from './company-careers.types';

/**
 * schema.org JobPosting, read off a company's own careers page.
 *
 * ## Why this is first in the priority order
 *
 * A JSON-LD block is the employer publishing structured facts on purpose, for
 * machines, in a format they chose to emit. Every other strategy in this
 * provider is inference from presentation — which anchor is a job, which
 * heading is a title — and inference is what breaks silently when a site is
 * redesigned. So JSON-LD is tried first wherever a source declares it.
 *
 * ## What was actually found
 *
 * Eleven careers pages were checked across four ATS vendors — Vercel, GitLab,
 * Discord, Figma, Ramp, Vanta, Linear, Ashby, Gopuff, Ro, Match Group — index
 * pages and job pages both. **Not one carried a JobPosting.** They carry
 * `Organization`, `WebSite`, `Article` and `BreadcrumbList`, which is exactly
 * the trap §13 of the design notes describes: a page "has JSON-LD" and none of
 * it is a job.
 *
 * That makes this module currently unexercised in production and fully
 * exercised in tests, which is stated rather than hidden. It is implemented
 * anyway because it is the correct first choice the day a configured source
 * does emit one, and because writing it later — under pressure, against a
 * live site — is how the Organization-as-a-job bug gets shipped.
 *
 * ## Nothing here is trusted
 *
 * A JSON-LD block is attacker-influenceable content on a third-party page. It
 * is parsed as data, never evaluated; every URL goes through `safeUrl`; every
 * description goes through the same HTML stripper the rest of the pipeline
 * uses, because `description` in a JobPosting is HTML by specification.
 */

/** Blocks per page. A page with hundreds is not a careers page. */
const MAX_BLOCKS = 50;
/** Nodes visited while flattening `@graph`/arrays. */
const MAX_NODES = 2_000;

const SCRIPT_BLOCK =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Every JSON-LD object on a page, flattened.
 *
 * Handles the three shapes that occur in the wild — a bare object, a top-level
 * array, and `@graph` — plus arbitrary nesting of the three. A malformed block
 * is skipped rather than thrown: a broken Organization block must not cost the
 * page its perfectly good JobPosting, and one syntax error on a marketing site
 * is not a reason to lose a company's whole careers listing.
 */
export function readJsonLdObjects(html: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  let blocks = 0;

  SCRIPT_BLOCK.lastIndex = 0;
  for (
    let match = SCRIPT_BLOCK.exec(html);
    match !== null && blocks < MAX_BLOCKS;
    match = SCRIPT_BLOCK.exec(html)
  ) {
    blocks += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    flatten(parsed, objects, 0);
  }
  return objects;
}

function flatten(
  node: unknown,
  out: Record<string, unknown>[],
  depth: number,
): void {
  if (depth > 8 || out.length >= MAX_NODES) return;
  if (Array.isArray(node)) {
    for (const entry of node) flatten(entry, out, depth + 1);
    return;
  }
  if (typeof node !== 'object' || node === null) return;

  const record = node as Record<string, unknown>;
  out.push(record);
  // `@graph` is how a site publishes several unrelated entities in one block.
  const graph = record['@graph'];
  if (graph) flatten(graph, out, depth + 1);
}

/**
 * Whether an object is a JobPosting.
 *
 * `@type` may be a string or an array (`["JobPosting", "Thing"]`), and the
 * check is exact: `Organization` is not a job, and neither is anything merely
 * containing the word.
 */
export function isJobPosting(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  if (typeof type === 'string') return type.trim() === 'JobPosting';
  if (Array.isArray(type)) {
    return type.some(
      (entry) => typeof entry === 'string' && entry.trim() === 'JobPosting',
    );
  }
  return false;
}

/** Every JobPosting on a page, in document order. */
export function readJobPostings(html: string): Record<string, unknown>[] {
  return readJsonLdObjects(html).filter(isJobPosting);
}

/**
 * One JobPosting → the facts this provider stores.
 *
 * Only explicit statements are mapped. Where schema.org allows several shapes
 * for one idea, an unrecognized shape produces null rather than a best guess:
 * `baseSalary` alone has three legal encodings, and a wrong reading of it is a
 * salary no employer wrote attached to a job a candidate will believe.
 */
export function jobFromJsonLd(
  node: Record<string, unknown>,
  pageUrl: string,
): CareersPageJob {
  const place = readLocations(node);
  const pay = readSalary(node);

  return {
    pageUrl,
    title: text(node.title, EXTERNAL_JOB_LIMITS.maxTitleLength),
    // `url` is the posting's own canonical link; `directApply` describes the
    // application flow and is not a URL, so it is never read as one.
    applyUrl: safeUrl(node.url) ?? null,
    locationText: null,
    countryCode: place.primary.countryCode,
    region: place.primary.region,
    city: place.primary.city,
    additionalLocations: place.additional,
    // HTML by specification: schema.org says description "may include HTML".
    description: plainDescription(
      node.description,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ),
    employmentTypeRaw: readEmploymentType(node),
    workModeRaw: readWorkMode(node),
    remoteCountriesAllowed: readApplicantCountries(node),
    salaryMin: pay.min,
    salaryMax: pay.max,
    currency: pay.currency,
    payPeriodRaw: pay.unitText,
    validThrough:
      typeof node.validThrough === 'string' ? node.validThrough : null,
    // `datePosted` is publication; `dateModified` is an edit. Only the first
    // is read, and the difference is the entire point of the field.
    datePosted: typeof node.datePosted === 'string' ? node.datePosted : null,
    companyName: readOrganizationName(node),
    companyWebsiteUrl: readOrganizationUrl(node),
  };
}

function readOrganizationName(node: Record<string, unknown>): string | null {
  const org = node.hiringOrganization;
  if (typeof org === 'string') {
    return text(org, EXTERNAL_JOB_LIMITS.maxCompanyNameLength);
  }
  if (typeof org === 'object' && org !== null) {
    return text(
      (org as Record<string, unknown>).name,
      EXTERNAL_JOB_LIMITS.maxCompanyNameLength,
    );
  }
  return null;
}

/**
 * The employer's own site.
 *
 * `sameAs` is read only when it is a single URL. It is defined as "a
 * reference web page that unambiguously indicates the item's identity" and is
 * routinely a Wikipedia article or a LinkedIn page — neither of which is a
 * company domain, and both of which would poison company identity if stored
 * as one. `url` on the organization is the unambiguous field.
 */
function readOrganizationUrl(node: Record<string, unknown>): string | null {
  const org = node.hiringOrganization;
  if (typeof org !== 'object' || org === null) return null;
  return safeUrl((org as Record<string, unknown>).url);
}

/**
 * `employmentType` — a string, or an array of them.
 *
 * An array with more than one value yields nothing. The canonical column holds
 * one employment type, and a posting stating both FULL_TIME and CONTRACTOR has
 * given two answers, which is not an answer. Mapping to the product vocabulary
 * happens later, in the shared `vocabulary.ts`, so this returns the raw token.
 */
function readEmploymentType(node: Record<string, unknown>): string | null {
  const stated = node.employmentType;
  if (typeof stated === 'string') return stated.trim() || null;
  if (Array.isArray(stated)) {
    const values = stated.filter(
      (entry): entry is string => typeof entry === 'string' && !!entry.trim(),
    );
    return values.length === 1 ? values[0].trim() : null;
  }
  return null;
}

/**
 * `jobLocationType: TELECOMMUTE` is the only remote statement schema.org makes.
 *
 * Nothing else is read as one. In particular, a posting with no `jobLocation`
 * is not remote — it is a posting that did not say where the work happens.
 */
function readWorkMode(node: Record<string, unknown>): string | null {
  const type = node.jobLocationType;
  const values =
    typeof type === 'string' ? [type] : Array.isArray(type) ? type : [];
  return values.some(
    (entry) =>
      typeof entry === 'string' && entry.trim().toUpperCase() === 'TELECOMMUTE',
  )
    ? 'REMOTE'
    : null;
}

/**
 * `applicantLocationRequirements` — where a remote candidate may live.
 *
 * Kept, because remote is not the same as worldwide. A role open to the United
 * States only is not open to a candidate in Seoul, and dropping the
 * restriction would send them to apply for a job they cannot legally take.
 * Absent means unknown, which the schema stores as an empty list and reads as
 * unknown everywhere — never as "anywhere".
 */
function readApplicantCountries(node: Record<string, unknown>): string[] {
  const stated = node.applicantLocationRequirements;
  const entries = Array.isArray(stated) ? stated : stated ? [stated] : [];
  const codes = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const name = (entry as Record<string, unknown>).name;
    if (typeof name !== 'string') continue;
    const code = countryCodeFromName(name);
    if (code) codes.add(code);
    if (codes.size >= EXTERNAL_JOB_LIMITS.maxRemoteCountries) break;
  }
  return [...codes];
}

/** Every `jobLocation`, primary first. Multi-location is normal, not a quirk. */
function readLocations(node: Record<string, unknown>): {
  primary: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  };
  additional: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  }[];
} {
  const stated = node.jobLocation;
  const entries = Array.isArray(stated) ? stated : stated ? [stated] : [];
  const places: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  }[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const address = (entry as Record<string, unknown>).address;
    if (typeof address !== 'object' || address === null) continue;
    const record = address as Record<string, unknown>;

    // `addressCountry` is an ISO code in well-formed data and a country NAME
    // in plenty of real data. Both are accepted; a name that maps to more than
    // one country maps to nothing.
    const rawCountry = text(record.addressCountry, 100);
    const countryCode = rawCountry
      ? rawCountry.length === 2
        ? rawCountry.toUpperCase()
        : countryCodeFromName(rawCountry)
      : null;
    const city = text(record.addressLocality, 200);
    const region = text(record.addressRegion, 200);
    if (!countryCode && !city && !region) continue;

    const key = [countryCode, region, city].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      countryCode,
      // A region that merely repeats the city is noise, not a second fact.
      region: region && region !== city ? region : null,
      city,
    });
    if (places.length >= EXTERNAL_JOB_LIMITS.maxRemoteCountries) break;
  }

  return {
    primary: places[0] ?? { countryCode: null, region: null, city: null },
    additional: places.slice(1),
  };
}

/**
 * `baseSalary`, when it is unambiguous.
 *
 * Only `MonetaryAmount` carrying a `QuantitativeValue` is read. The other
 * legal encodings — a bare number, a `PriceSpecification`, a currency with no
 * amount — are left alone, and so is anything whose numbers fail the shared
 * sanity bounds.
 *
 * A `value` (single amount) becomes min AND max, because that is what the
 * employer stated: one number, not a range with an open end. A range with only
 * `maxValue` yields nothing, since a ceiling alone tells a candidate nothing
 * about whether the job pays enough.
 */
function readSalary(node: Record<string, unknown>): {
  min: number | null;
  max: number | null;
  currency: string | null;
  unitText: string | null;
} {
  const none = { min: null, max: null, currency: null, unitText: null };
  const salary = node.baseSalary;
  if (typeof salary !== 'object' || salary === null) return none;
  const record = salary as Record<string, unknown>;
  if (
    typeof record['@type'] === 'string' &&
    record['@type'] !== 'MonetaryAmount'
  ) {
    return none;
  }

  const currency = text(record.currency, 10);
  const amount = record.value;
  if (typeof amount !== 'object' || amount === null) return none;
  const value = amount as Record<string, unknown>;
  if (
    typeof value['@type'] === 'string' &&
    value['@type'] !== 'QuantitativeValue'
  ) {
    return none;
  }

  const single = numeric(value.value);
  const min = single ?? numeric(value.minValue);
  const max = single ?? numeric(value.maxValue);
  if (min === null || !currency) return none;

  const unitText = text(value.unitText, 30);
  return { min, max: max ?? min, currency, unitText };
}

function numeric(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/[\s,_]/g, ''))
        : NaN;
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (
    rounded < EXTERNAL_JOB_LIMITS.minSalary ||
    rounded > EXTERNAL_JOB_LIMITS.maxSalary
  ) {
    return null;
  }
  return rounded;
}
