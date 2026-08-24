import { countryCodeFromName } from '../../../common/vacancy/country-names';
import { EXTERNAL_JOB_LIMITS } from '../../external-job.limits';
import {
  currencyCode,
  plainDescription,
  safeUrl,
  salaryAmount,
  text,
  timestamp,
} from '../../normalize';
import {
  employmentTypeFrom,
  payPeriodFrom,
  workModeFrom,
} from '../../vocabulary';
import type { NormalizedExternalJobInput } from '../../external-job.contract';
import type { LeverPosting } from './lever.types';

/**
 * One Lever public posting → the shared contract.
 *
 * ## Lever states more than Greenhouse, so more is mapped
 *
 * The public Postings API has dedicated fields for things Greenhouse leaves to
 * prose: `country` is already ISO alpha-2, `workplaceType` is a structured
 * enum, `categories.commitment` names an employment type, and `salaryRange`
 * carries min, max, currency and interval. All of those are mapped, because
 * mapping a STATED field is not a guess.
 *
 * The line is unchanged from Greenhouse, it just falls in a different place:
 * a structured field is read, prose never is. `workplaceType: "remote"` is a
 * fact; a location label reading "New York, NY or Remote" is a sentence, and
 * nothing here reads a work arrangement out of it.
 *
 * ## Where Lever's own vocabulary stops being usable
 *
 * `commitment` and `interval` are tenant-configured free text, not vendor
 * enums — one site writes "Full-time", another "Full Time/Part Time", a third
 * "Fixed Term". They go through the shared dictionaries in `vocabulary.ts`,
 * which map what they recognize and return null for everything else. A value
 * with two answers in it gets no answer.
 */
export function normalizeLeverPosting(
  raw: LeverPosting,
  site: { slug: string; label: string },
): NormalizedExternalJobInput | null {
  const title = text(raw.text, EXTERNAL_JOB_LIMITS.maxTitleLength);
  // `hostedUrl` is the public posting page and the canonical place to read it.
  const hostedUrl = safeUrl(raw.hostedUrl);
  const postingId = text(raw.id, 200);
  // No title, no link or no id means there is nothing to show, nowhere to send
  // anyone, and no way to recognize it again. That is a rejection, not a
  // partial record.
  if (!title || !hostedUrl || !postingId) return null;

  const place = resolvePlace(raw);
  const pay = resolvePay(raw);

  return {
    provider: 'LEVER',
    accessMethod: 'OFFICIAL_API',
    /*
     * Site-qualified, exactly as Greenhouse is board-qualified. A Lever posting
     * id is unique within a site while `(provider, sourceKey)` is global, and
     * two sites colliding on an id would silently overwrite one real job with
     * another.
     */
    sourceJobId: `${site.slug}:${postingId}`,
    sourceUrl: hostedUrl,
    // Lever distinguishes the posting page from the application form, so both
    // are kept: the apply URL is where a candidate is actually sent.
    originalUrl: safeUrl(raw.applyUrl) ?? hostedUrl,
    companyName:
      text(site.label, EXTERNAL_JOB_LIMITS.maxCompanyNameLength) ?? site.slug,
    /*
     * Lever states no company URL. The posting lives on jobs.lever.co — the
     * ATS, not the employer — so deriving a domain from it would give every
     * Lever company the same identity and merge them all into one. Dedupe
     * falls back to the folded company name, which is the weaker claim it is
     * designed to treat as weaker.
     */
    companyWebsiteUrl: null,
    companyCountryCode: null,
    title,
    description: assembleDescription(raw),
    /*
     * Lever's `lists` are headed sections, but the headings are tenant free
     * text — "Required Qualifications", "What you'll need", "Requirements".
     * Picking the requirements one out by name is the same guesswork as
     * reading Greenhouse metadata, so every section joins the description and
     * this stays null.
     */
    requirementsText: null,
    countryCode: place.countryCode,
    region: place.region,
    city: place.city,
    // This API states no additional work locations.
    additionalLocations: [],
    // A stated structured field, unlike Greenhouse where none exists.
    workMode: workModeFrom(raw.workplaceType),
    /*
     * Lever states no remote-country eligibility. REMOTE never means
     * worldwide — remote work is bounded by law and payroll — so this stays
     * empty, which downstream reads as unknown geography.
     */
    remoteCountriesAllowed: [],
    employmentType: employmentTypeFrom(raw.categories?.commitment),
    /*
     * No seniority field exists. A title containing "Senior" is not one:
     * "Senior Account Executive" is a sales band, not a career level.
     */
    seniorityLevel: null,
    salaryMin: pay.min,
    salaryMax: pay.max,
    currency: pay.currency,
    payPeriod: pay.period,
    skills: [],
    /*
     * `team` and `department` are org units — "Hyperconnect", "Management",
     * "Tinder". Storing them as industries would make an internal team name
     * filterable as a sector.
     */
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    // The public API exposes no deadline; `createdAt` is the opposite of one.
    /*
     * NULL, and deliberately so — this is the largest single gap in this
     * catalogue's date coverage and it is the honest answer.
     *
     * The public postings API carries exactly one date-shaped field,
     * `createdAt` (epoch milliseconds, present on all 942 live postings). It
     * is **absent from Lever's official field reference entirely** — their own
     * postings-api repository carries an open issue asking what it means —
     * and its name describes when the posting RECORD was created in Lever. A
     * posting is drafted first and published later, so creation is an upper
     * bound on nothing a candidate cares about and a lower bound on
     * publication.
     *
     * Mapping it would put "Posted 3 days ago" on screen from a number nobody
     * has ever defined. Half a catalogue with no date is better than half a
     * catalogue with a plausible wrong one, because a reader cannot tell the
     * second kind apart.
     */
    employerPosted: null,
    expiresAt: null,
    /*
     * The public Postings API returns published postings only — everything
     * else is hidden from it entirely. So a posting that is here is live, and
     * closure is established by ABSENCE from a later complete listing.
     */
    closedAtSource: false,
  };
}

/**
 * The whole posting body as plain text.
 *
 * `description` deliberately excludes `lists`, which is where the
 * responsibilities and requirements live — verified against live data, where
 * a posting's `descriptionPlain` ended before "Key Responsibilities" and the
 * entire qualifications section sat in a separate array. Storing only the
 * description would drop most of what the job actually says.
 *
 * Everything is run through the shared extractor even when Lever offers a
 * `Plain` variant, because "the provider says this is plain text" is a claim
 * about someone else's escaping, and the cost of checking is nothing.
 */
function assembleDescription(raw: LeverPosting): string | null {
  const parts: string[] = [];

  const body =
    plainDescription(
      raw.descriptionPlain,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ) ??
    plainDescription(raw.description, EXTERNAL_JOB_LIMITS.maxDescriptionLength);
  if (body) parts.push(body);

  const lists = Array.isArray(raw.lists) ? raw.lists : [];
  for (const list of lists) {
    const heading = text(list?.text, 200);
    const content = plainDescription(
      list?.content,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    );
    if (!heading && !content) continue;
    parts.push([heading, content].filter(Boolean).join('\n'));
  }

  const closing = plainDescription(
    raw.additionalPlain ?? raw.additional,
    EXTERNAL_JOB_LIMITS.maxDescriptionLength,
  );
  if (closing) parts.push(closing);

  const joined = parts.join('\n\n').trim();
  if (!joined) return null;
  return joined.length > EXTERNAL_JOB_LIMITS.maxDescriptionLength
    ? joined.slice(0, EXTERNAL_JOB_LIMITS.maxDescriptionLength)
    : joined;
}

/**
 * Where the job is.
 *
 * The country comes from Lever's own `country` field, which is already ISO
 * alpha-2 — no inference at all. The city is the harder half, because
 * `categories.location` is free text a recruiter typed, and live data holds
 * "Seoul, South Korea", "New York, NY", "Tokyo" and "New York, NY or Remote"
 * side by side.
 *
 * Two refusals, both deliberate:
 *
 *   - a posting open in SEVERAL places gets no city. `allLocations` with two
 *     entries means the schema's single city column cannot express the truth,
 *     and picking the first is inventing certainty. Precision is lost; nothing
 *     false is stored.
 *   - a label carrying an alternative ("or Remote", "/", "Multiple") gets no
 *     city either, because the first segment is no longer the whole answer.
 */
function resolvePlace(raw: LeverPosting): {
  countryCode: string | null;
  region: string | null;
  city: string | null;
} {
  // Lever states the country outright. `countryCodeFromName` accepts an
  // alpha-2 code as well as a name, so a provider that later sends "Germany"
  // needs no change here.
  const countryCode = countryCodeFromName(raw.country);

  const all = Array.isArray(raw.categories?.allLocations)
    ? raw.categories.allLocations.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  if (all.length > 1) return { countryCode, region: null, city: null };

  const label =
    typeof raw.categories?.location === 'string'
      ? raw.categories.location
      : (all[0] ?? null);
  if (!label) return { countryCode, region: null, city: null };
  if (AMBIGUOUS_LOCATION.test(label)) {
    return { countryCode, region: null, city: null };
  }

  const segments = label
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length === 0) return { countryCode, region: null, city: null };

  // A lone segment naming a country ("Singapore") is not also a city claim we
  // can make — city-states are exactly where that reasoning breaks.
  if (segments.length === 1 && countryCodeFromName(segments[0])) {
    return { countryCode, region: null, city: null };
  }

  // Drop a trailing country name so "Seoul, South Korea" does not record
  // "South Korea" as a region.
  const tail = segments[segments.length - 1];
  const withoutCountry = countryCodeFromName(tail)
    ? segments.slice(0, -1)
    : segments;
  if (withoutCountry.length === 0) {
    return { countryCode, region: null, city: null };
  }

  return {
    countryCode,
    region:
      withoutCountry.length > 1
        ? text(withoutCountry[withoutCountry.length - 1], 120)
        : null,
    city: text(withoutCountry[0], 120),
  };
}

/**
 * Labels that describe a choice, a region or an arrangement rather than one
 * place. None of these may become a city.
 */
const AMBIGUOUS_LOCATION =
  /\b(remote|hybrid|anywhere|worldwide|global|multiple|various|emea|apac|amer|latam|nam)\b|\bor\b|\//i;

/**
 * The posted salary, in the currency the employer posted it in.
 *
 * Amounts are MAJOR units here — the opposite of Greenhouse's `min_cents` —
 * which is the clearest argument for provider-owned mapping: the shared schema
 * stores one meaning, and each provider is responsible for producing it.
 *
 * An interval the enum cannot express (Lever emits `bi-week-salary` live)
 * leaves the AMOUNTS intact and the period null. Annualising it would turn a
 * stated fact into a derived one and store it as though the employer had said
 * it; the matcher instead reports the job as not comparable on salary, which
 * is visible and true. Nothing is parsed out of `salaryDescription` prose.
 */
function resolvePay(raw: LeverPosting): {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: ReturnType<typeof payPeriodFrom>;
} {
  const range = raw.salaryRange;
  const none = { min: null, max: null, currency: null, period: null } as const;
  if (!range) return { ...none };

  const currency = currencyCode(range.currency);
  const min = salaryAmount(range.min);
  const max = salaryAmount(range.max);

  // A currency this product cannot compare makes the amounts uninterpretable,
  // and an amount with no currency is a number, not a salary.
  if (!currency || (min === null && max === null)) return { ...none };
  // A floor above its ceiling is a bad payload, not a range.
  if (min !== null && max !== null && min > max) return { ...none };

  return { min, max, currency, period: payPeriodFrom(range.interval) };
}

/** Epoch-millisecond `createdAt`, for callers that want posting age. */
export function leverCreatedAt(raw: LeverPosting): Date | null {
  return timestamp(raw.createdAt);
}
