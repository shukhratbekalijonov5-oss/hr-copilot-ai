import { parseLocationString } from '../../../common/vacancy/country-names';
import { EXTERNAL_JOB_LIMITS } from '../../external-job.limits';
import {
  currencyCode,
  plainDescription,
  publicationDate,
  safeUrl,
  text,
  timestamp,
} from '../../normalize';
import type { NormalizedExternalJobInput } from '../../external-job.contract';
import type { GreenhouseJob, GreenhouseOffice } from './greenhouse.types';

/**
 * One Greenhouse job post → the shared contract.
 *
 * ## What this maps, and the much longer list of what it refuses to
 *
 * The public Job Board API states a title, a company, a location, a
 * description and — when the board enables pay transparency — a salary range.
 * It does NOT state employment type, work arrangement, seniority, visa
 * sponsorship, required languages or skills. There is no field for them, and
 * there is no honest way to derive them:
 *
 *   - `location.name` reads "Hybrid - London", and turning that into
 *     `HYBRID` is reading a recruiter's label as a schema. The next board
 *     writes "London (Hybrid-ish)" or "Flexible", and the one after that
 *     writes "Hybrid" for a job that is fully on-site three days a week.
 *   - a title containing "Senior" is not a seniority field. "Senior Account
 *     Executive" is a sales band, not a career level, and mapping it would
 *     quietly re-rank half a board.
 *   - metadata is per-board custom configuration. Across the boards this was
 *     built against it holds "Career Site Categories" and "Quota Coverage
 *     Type" — nothing an enum here could read.
 *
 * So they stay null. In this product null means "the source did not say", and
 * a candidate's filters treat that as unproven rather than disqualifying — the
 * job still ranks and is still shown. A guess would do the opposite: it would
 * be trusted, and it would be wrong silently.
 *
 * The one thing this DOES resolve is the country, because Greenhouse states it
 * in words ("United Kingdom") and a dictionary lookup is not a guess.
 */
export function normalizeGreenhouseJob(
  raw: GreenhouseJob,
  board: { boardToken: string; label: string },
): NormalizedExternalJobInput | null {
  const title = text(raw.title, EXTERNAL_JOB_LIMITS.maxTitleLength);
  const url = safeUrl(raw.absolute_url);
  // Identity: without a title or a link there is no job to show and no place
  // to send anyone, so this is a rejection rather than a partial record.
  if (!title || !url) return null;

  const postId = jobId(raw.id);
  if (!postId) return null;
  /*
   * The source identity is `board:postId`, not the bare id.
   *
   * A Greenhouse job id is only meaningful inside its board, and the
   * `(provider, sourceKey)` uniqueness that makes re-syncing idempotent is
   * global across every board this deployment reads. Two boards colliding on
   * an id would silently overwrite each other's posting — one real job
   * quietly replacing another. Qualifying by board makes the key as unique as
   * the constraint assumes, and gives revalidation an address it can re-fetch.
   */
  const sourceJobId = `${board.boardToken}:${postId}`;

  const companyName =
    text(raw.company_name, EXTERNAL_JOB_LIMITS.maxCompanyNameLength) ??
    text(board.label, EXTERNAL_JOB_LIMITS.maxCompanyNameLength);
  if (!companyName) return null;

  const place = resolvePlace(raw);
  const pay = resolvePay(raw);

  return {
    provider: 'GREENHOUSE',
    accessMethod: 'OFFICIAL_API',
    sourceJobId,
    sourceUrl: url,
    // Greenhouse's `absolute_url` IS the public apply page; there is no
    // separate apply link to prefer.
    originalUrl: url,
    companyName,
    /*
     * Greenhouse states a company NAME and no company URL. The job's own host
     * is greenhouse.io — the ATS, not the employer — so deriving a domain from
     * it would give every Greenhouse company the same identity and merge them
     * all into one. Null is correct, and dedupe falls back to the folded name.
     */
    companyWebsiteUrl: null,
    companyCountryCode: null,
    title,
    description: plainDescription(
      raw.content,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ),
    // Greenhouse keeps requirements inside the description body; splitting
    // prose on a heading guess would invent a structure the source lacks.
    requirementsText: null,
    countryCode: place.countryCode,
    region: place.region,
    city: place.city,
    // This API states no additional work locations.
    additionalLocations: [],
    workMode: null,
    remoteCountriesAllowed: [],
    employmentType: null,
    seniorityLevel: null,
    salaryMin: pay.min,
    salaryMax: pay.max,
    currency: pay.currency,
    payPeriod: pay.period,
    skills: [],
    // Departments are org units ("Account Executive", "Platforms
    // Engineering"), not industries. Storing them in `industries` would make
    // a team name filterable as a sector.
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    /*
     * `first_published` — the board's own publication timestamp.
     *
     * Verified against live payloads rather than taken on faith: it is present
     * on 255 of 255 postings across two boards, appears on both the list and
     * the detail endpoint with the same value, carries an explicit offset
     * (-04:00/-05:00), and is <= `updated_at` on EVERY row — exactly the
     * invariant a "first published" field must satisfy against a
     * "last modified" one, and the strongest available evidence that the two
     * are different facts rather than the same clock.
     *
     * Official documentation shows it in the "Retrieve a job" example response
     * but never describes it, so the semantics come from the name plus that
     * measurement. Recorded as FIRST_PUBLISHED, which is what the name says.
     *
     * `updated_at` is deliberately NOT read here: it moves whenever anyone
     * edits a posting, and 81% of live rows differ between the two.
     */
    employerPosted: publicationDate(raw.first_published)
      ? {
          at: publicationDate(raw.first_published) as Date,
          semantics: 'FIRST_PUBLISHED' as const,
        }
      : null,
    expiresAt: timestamp(raw.application_deadline),
    // A job returned by the board listing is, by definition, listed. Closure
    // is established by ABSENCE from a later complete listing, not here.
    closedAtSource: false,
  };
}

/** The post id as a string. Numbers and numeric strings only. */
function jobId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^[0-9]{1,20}$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

/**
 * Where the job is.
 *
 * `offices[].location` is a structured office record and reads
 * "London, England, United Kingdom", so city, region and country are all
 * genuinely available. `location.name` is a free-text label a recruiter typed
 * — "Remote, Italy", "San Francisco Bay Area or New York (Remote)" — so only
 * the country is taken from it. Splitting "Remote, Italy" on the comma and
 * calling "Remote" a city would put a filterable city named Remote in the
 * database.
 *
 * When offices disagree about the country, none is recorded. A job posted to
 * both a Berlin and a Singapore office is not in Germany; it is in two places,
 * and this schema holds one.
 */
function resolvePlace(raw: GreenhouseJob): {
  countryCode: string | null;
  region: string | null;
  city: string | null;
} {
  const offices: GreenhouseOffice[] = Array.isArray(raw.offices)
    ? raw.offices
    : [];
  const parsed = offices
    .map((office) => parseLocationString(office?.location))
    .filter((entry) => entry.countryCode !== null);

  const countries = new Set(parsed.map((entry) => entry.countryCode!));
  if (countries.size === 1) {
    const only = parsed.length === 1 ? parsed[0] : null;
    return {
      countryCode: [...countries][0],
      // City and region are only trustworthy when ONE office supplied them.
      // Several offices in one country ("Austin" and "New York") have no
      // single city, and picking the first is arbitrary.
      region: only ? text(only.region, 120) : null,
      city: only ? text(only.city, 120) : null,
    };
  }
  if (countries.size > 1) {
    return { countryCode: null, region: null, city: null };
  }

  // No usable office. The free-text label may still name a country.
  const label = parseLocationString(
    typeof raw.location?.name === 'string' ? raw.location.name : null,
  );
  return { countryCode: label.countryCode, region: null, city: null };
}

/**
 * The posted salary, in the currency the employer posted it in.
 *
 * Two things this gets right that a naive mapping would not:
 *
 *   1. `min_cents` is MINOR units. 13920000 is $139,200, and storing it as
 *      posted would tell the matcher this role pays fourteen million.
 *   2. A job may carry SEVERAL ranges — a US band and a Canadian band for one
 *      opening. In one currency they are unioned, which is a claim the source
 *      supports: the pay falls somewhere in that span. Across currencies there
 *      is no single answer, and converting here would put FX inside a provider,
 *      which is the one thing the salary architecture forbids. So it stays
 *      null and the job simply competes without a salary signal.
 *
 * Nothing is parsed out of `blurb` prose. That text exists to satisfy pay
 * transparency law, not to be a data source.
 */
function resolvePay(raw: GreenhouseJob): {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: 'YEARLY' | null;
} {
  const none = { min: null, max: null, currency: null, period: null } as const;
  const ranges = Array.isArray(raw.pay_input_ranges)
    ? raw.pay_input_ranges
    : [];
  if (ranges.length === 0) return { ...none };

  const usable = ranges
    .map((range) => ({
      min: majorUnits(range?.min_cents),
      max: majorUnits(range?.max_cents),
      currency: currencyCode(range?.currency_type),
    }))
    .filter(
      (range) => range.currency && (range.min !== null || range.max !== null),
    );

  if (usable.length === 0) return { ...none };

  const currencies = new Set(usable.map((range) => range.currency!));
  if (currencies.size > 1) return { ...none };

  const mins = usable
    .map((range) => range.min)
    .filter((value): value is number => value !== null);
  const maxes = usable
    .map((range) => range.max)
    .filter((value): value is number => value !== null);

  const min = mins.length > 0 ? Math.min(...mins) : null;
  const max = maxes.length > 0 ? Math.max(...maxes) : null;
  // A range whose floor is above its ceiling is a bad payload, not a salary.
  if (min !== null && max !== null && min > max) return { ...none };

  return {
    min,
    max,
    currency: [...currencies][0],
    /*
     * Greenhouse's pay ranges carry no interval field. Every observed range is
     * an annual base band, and the disclosure text calls it one — but this is
     * the single place a period is asserted rather than read, so it is the
     * documented limitation of this provider. A range that is in fact hourly
     * would read as an implausibly low annual figure and rank the job down,
     * which is the harmless direction for the error to run.
     */
    period: 'YEARLY',
  };
}

/** Minor units → major units. Rejects anything that is not a whole amount. */
function majorUnits(value: unknown): number | null {
  const cents =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?[0-9]+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(cents) || cents <= 0) return null;
  const major = Math.round(cents / 100);
  if (major < EXTERNAL_JOB_LIMITS.minSalary) return null;
  if (major > EXTERNAL_JOB_LIMITS.maxSalary) return null;
  return major;
}
