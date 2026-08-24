import { parseKoreanAddress } from '../../../common/vacancy/korean-address';
import { EXTERNAL_JOB_LIMITS } from '../../external-job.limits';
import { plainDescription, safeUrl, text, timestamp } from '../../normalize';
import { employmentTypeFrom } from '../../vocabulary';
import type {
  ExternalJobLocation,
  NormalizedExternalJobInput,
} from '../../external-job.contract';
import type { NinehireJob, NinehireJobLocation } from './ninehire.types';

/**
 * One Ninehire posting → the shared contract.
 *
 * Ninehire is the first AUTHENTICATED provider and the first with genuinely
 * unambiguous lifecycle data, and those two facts shape everything here.
 *
 *  1. **`status` distinguishes CLOSED from merely unavailable.** Greenhouse,
 *     Lever and Ashby can only ever say "it stopped appearing"; Ninehire says
 *     `closed` — 채용 마감됨, hiring closed — which is the employer's own
 *     statement and the first real evidence the generic `closedAtSource` flag
 *     has ever had.
 *  2. **Korean is stored as Korean.** Titles, addresses and descriptions are
 *     kept verbatim as Unicode. Nothing is translated, transliterated or
 *     forced through an English taxonomy.
 *
 * The API exposes NO salary or compensation field of any kind — verified
 * against the official field tables for both endpoints — so every salary field
 * here is null. That is a finding, not an omission.
 */

/** Statuses that belong in a public candidate search. */
export const NINEHIRE_LISTABLE_STATUS = 'in_progress';
/** The one status that is positive evidence the employer ended the role. */
export const NINEHIRE_CLOSED_STATUS = 'closed';

/**
 * Whether a posting may be shown to candidates at all.
 *
 * Private postings never reach this — the provider does not even ASK for them
 * (`includePrivate=false`), which is a stronger guarantee than filtering after
 * the fact: unauthorized data is not received, not merely discarded.
 *
 * Of the four statuses, only two are ingested:
 *
 *   in_progress  recruiting            → ingested, candidate-listable
 *   closed       hiring closed         → ingested, marked closed at source
 *   disabled     paused, still hiring  → NOT ingested
 *   archived     archived              → NOT ingested
 *
 * `disabled` and `archived` are dropped rather than flagged because neither is
 * a closure: the employer has not ended the role, they have stopped showing
 * it. Dropping them means they vanish from the next complete snapshot, and the
 * generic absence rule retires the source as GONE and the job as UNAVAILABLE —
 * exactly the right distinction, with no new status invented for it.
 */
export function ninehireIngestable(raw: NinehireJob): boolean {
  if (raw?.isPrivate === true) return false;
  const status = typeof raw?.status === 'string' ? raw.status.trim() : '';
  return (
    status === NINEHIRE_LISTABLE_STATUS || status === NINEHIRE_CLOSED_STATUS
  );
}

export function normalizeNinehireJob(
  raw: NinehireJob,
  source: { scope: string; label: string },
): NormalizedExternalJobInput | null {
  const title = text(raw.title, EXTERNAL_JOB_LIMITS.maxTitleLength);
  /*
   * The official page shows `url` in the list SAMPLE and `applyUrl` in the
   * list FIELD TABLE. Both are read, because trusting one would silently drop
   * every posting on whichever shape the API actually returns.
   */
  const applyUrl = safeUrl(raw.applyUrl) ?? safeUrl(raw.url);
  const postingId = text(raw.id, 200);
  if (!title || !applyUrl || !postingId) return null;

  const places = resolveLocations(raw);

  return {
    provider: 'NINEHIRE',
    accessMethod: 'OFFICIAL_API',
    /*
     * Workspace-scoped. The docs call the id "공고별 고유한 ID 값" — unique per
     * POSTING — and say nothing about uniqueness across workspaces, so it is
     * not assumed. Two workspaces colliding on an id would silently overwrite
     * one authorized customer's job with another's.
     */
    sourceJobId: `${source.scope}:${postingId}`,
    // Ninehire exposes one public URL: the apply page.
    sourceUrl: applyUrl,
    originalUrl: applyUrl,
    /*
     * The configured source label is the stronger company context: an operator
     * configuring a workspace knows whose it is, whereas `affiliation` (소속)
     * is an internal grouping that may name a division rather than the
     * employer.
     */
    companyName:
      text(source.label, EXTERNAL_JOB_LIMITS.maxCompanyNameLength) ??
      text(raw.affiliation, EXTERNAL_JOB_LIMITS.maxCompanyNameLength) ??
      source.scope,
    // No company URL is exposed, and career.ninehire.com is the ATS.
    companyWebsiteUrl: null,
    companyCountryCode: null,
    title,
    // `content` exists only on the detail endpoint; a list-only posting simply
    // has no description rather than a fabricated one.
    description: plainDescription(
      raw.content,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ),
    requirementsText: null,
    countryCode: places.primary.countryCode,
    region: places.primary.region,
    city: places.primary.city,
    additionalLocations: places.additional,
    /*
     * No work-arrangement field exists. 재택/원격 is sometimes written into a
     * title or a description, and reading it out of prose is the guess this
     * product refuses everywhere else too.
     */
    workMode: null,
    remoteCountriesAllowed: [],
    employmentType: resolveEmploymentType(raw),
    /*
     * `career` is irrelevant/experienced/newcomer and `careerRange` is a span
     * of YEARS. Neither is a seniority level. "experienced" means prior
     * experience is required — not SENIOR — and 신입 (newcomer) is a hiring
     * track, not a rung. Mapping either would re-rank the catalogue on a
     * mistranslation, so seniority stays null and the evidence is left unused
     * rather than misused.
     */
    seniorityLevel: null,
    /*
     * The API exposes no compensation field on either endpoint. Verified
     * against the official response tables, not assumed from the Task 4A
     * fixture — which was a structural stand-in and did not match reality.
     */
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    skills: [],
    /*
     * `jobGroup` is 직군 — an org group, "개발팀" (development TEAM). `jobTask`
     * is 직무, closer to a role but still source-defined free text. Neither is
     * an industry, and `tags` are arbitrary workspace labels that may be a
     * benefit, a campaign or a location. None is mapped.
     */
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    /*
     * The employer's own published deadline. Null for 상시 채용 — rolling
     * hiring with no end date — which is a stated fact, not missing data.
     */
    /*
     * NULL. Ninehire's documented list/detail payload carries `createdAt`,
     * which is when the posting record was created in the workspace — the same
     * distinction that rules out Lever's field of the same name. There is no
     * publication timestamp in the documented shape.
     *
     * `deadline` below is the opposite end of the posting's life and is
     * already mapped to `expiresAt`; it says nothing about when the employer
     * published.
     */
    employerPosted: null,
    expiresAt: timestamp(raw.deadline),
    /*
     * The first real closure evidence any provider has given us: `closed`
     * means 채용 마감됨, the employer ended it. Every other provider can only
     * report that a posting stopped appearing.
     */
    closedAtSource:
      typeof raw.status === 'string' &&
      raw.status.trim() === NINEHIRE_CLOSED_STATUS,
  };
}

/**
 * Employment type, from a MULTI-VALUED source into a single column.
 *
 * Ninehire states an array, and the schema holds one value, so the only honest
 * answers are "exactly one, and it maps" or "nothing":
 *
 *   ["full_time"]                → FULL_TIME
 *   ["full_time", "contractor"]  → null   (two answers is no answer)
 *   ["freelancer"]               → null   (see below)
 *
 * Four documented values have no home in the enum — freelancer, dispatched
 * (파견직), day_labor (일용직) and trainee (교육생). Three of those are
 * specifically Korean labour-market arrangements with distinct legal meaning,
 * and adding them would ripple into the internal vacancy form, four frontend
 * dictionaries and the matcher to serve one provider. The information is lost
 * and the loss is documented rather than papered over by rounding 파견직 to
 * CONTRACT, which would tell a candidate they are being hired by the company
 * they would actually be dispatched to.
 */
function resolveEmploymentType(
  raw: NinehireJob,
): ReturnType<typeof employmentTypeFrom> {
  // The list returns `employmentTypes`; the documented detail sample returns
  // `employmentType`. Both are read.
  const stated = Array.isArray(raw.employmentTypes)
    ? raw.employmentTypes
    : Array.isArray(raw.employmentType)
      ? raw.employmentType
      : typeof raw.employmentType === 'string'
        ? [raw.employmentType]
        : [];

  const values = stated.filter(
    (entry): entry is string =>
      typeof entry === 'string' && entry.trim() !== '',
  );
  if (values.length !== 1) return null;
  return employmentTypeFrom(values[0]);
}

/**
 * Every place the posting is open in.
 *
 * `jobLocations` is an array, so this is the second provider — after Ashby —
 * to prove multi-location is a generic requirement rather than a quirk. The
 * first entry is primary and the rest go to `additionalLocations`; none is
 * discarded.
 *
 * Two refusals worth naming:
 *
 *   - `name` ("부산지사", Busan BRANCH) is a site label, not a city. It is
 *     never stored as one.
 *   - `x`/`y` are longitude and latitude, and they are read but not stored:
 *     the canonical schema has no coordinate columns, nothing would query them
 *     today, and adding a pair for one provider is how a schema fills up with
 *     fields nobody reads. Documented as a known loss; a future radius search
 *     would add them provider-neutrally.
 */
function resolveLocations(raw: NinehireJob): {
  primary: ExternalJobLocation;
  additional: ExternalJobLocation[];
} {
  const entries = Array.isArray(raw.jobLocations) ? raw.jobLocations : [];
  const parsed: ExternalJobLocation[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const place = resolveLocation(entry);
    if (!place.countryCode && !place.region && !place.city) continue;
    const key = [place.countryCode, place.region, place.city].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(place);
    if (parsed.length >= EXTERNAL_JOB_LIMITS.maxRemoteCountries) break;
  }

  return {
    primary: parsed[0] ?? { countryCode: null, region: null, city: null },
    additional: parsed.slice(1),
  };
}

function resolveLocation(entry: NinehireJobLocation): ExternalJobLocation {
  const korean = parseKoreanAddress(entry?.address);
  if (korean.countryCode) {
    return {
      countryCode: korean.countryCode,
      region: korean.region,
      city: korean.city,
    };
  }
  /*
   * A non-Korean address yields nothing rather than a guess. Ninehire is a
   * Korean ATS and its addresses are overwhelmingly domestic; the rest are
   * free text this layer has no deterministic way to place, and an
   * approximately-placed job is worse than an unplaced one.
   */
  return { countryCode: null, region: null, city: null };
}
