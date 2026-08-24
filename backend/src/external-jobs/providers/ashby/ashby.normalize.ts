import { countryCodeFromName } from '../../../common/vacancy/country-names';
import { EXTERNAL_JOB_LIMITS } from '../../external-job.limits';
import {
  currencyCode,
  plainDescription,
  publicationDate,
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
import type {
  ExternalJobLocation,
  NormalizedExternalJobInput,
} from '../../external-job.contract';
import type {
  AshbyCompensationComponent,
  AshbyJob,
  AshbyPostalAddress,
} from './ashby.types';

/**
 * One Ashby public posting → the shared contract.
 *
 * Ashby is the richest of the three providers and the first to make refusing
 * data harder than accepting it. Three things here are load-bearing:
 *
 *  1. **Only `compensationType: "Salary"` may become a salary.** Live boards
 *     also return Bonus, Commission, EquityPercentage and EquityCashValue. An
 *     equity percentage is not money per year, and a commission target is not
 *     a salary — putting either in the salary column would rank the job
 *     against a candidate's stated range as though the employer had promised
 *     it.
 *  2. **Multi-currency tiers produce NO salary.** See `resolvePay`.
 *  3. **`workplaceType` decides the work mode; `isRemote` never does.** Live
 *     data carries `isRemote: true` beside `workplaceType: "Hybrid"` on 231 of
 *     584 postings, so the boolean plainly does not mean "fully remote".
 */
export function normalizeAshbyJob(
  raw: AshbyJob,
  board: { slug: string; label: string },
): NormalizedExternalJobInput | null {
  const title = text(raw.title, EXTERNAL_JOB_LIMITS.maxTitleLength);
  const jobUrl = safeUrl(raw.jobUrl);
  /*
   * The posting id is undocumented but present on every live posting, and it
   * is the only stable identity available: the title is not unique, the
   * position in the array is not stable across fetches, and hashing a mutable
   * description would change identity every time an employer fixed a typo.
   */
  const postingId = text(raw.id, 200);
  if (!title || !jobUrl || !postingId) return null;

  const place = resolvePlace(raw.address?.postalAddress);
  const pay = resolvePay(raw);

  return {
    provider: 'ASHBY',
    accessMethod: 'OFFICIAL_API',
    // Board-qualified, as Greenhouse and Lever are: the id is unique within a
    // board while `(provider, sourceKey)` is global.
    sourceJobId: `${board.slug}:${postingId}`,
    sourceUrl: jobUrl,
    // Ashby separates the posting page from the application form.
    originalUrl: safeUrl(raw.applyUrl) ?? jobUrl,
    companyName:
      text(board.label, EXTERNAL_JOB_LIMITS.maxCompanyNameLength) ?? board.slug,
    /*
     * The board name is a provider scope, not corporate identity, and the
     * payload states no company URL. Postings live on ashbyhq.com — the ATS,
     * not the employer — so a domain taken from there would give every Ashby
     * company one identity and merge them all.
     */
    companyWebsiteUrl: null,
    companyCountryCode: null,
    title,
    description: resolveDescription(raw),
    // Ashby ships one description body; splitting requirements out of it would
    // mean guessing at headings.
    requirementsText: null,
    countryCode: place.countryCode,
    region: place.region,
    city: place.city,
    additionalLocations: resolveSecondaryLocations(raw, place),
    /*
     * The documented structured field, and only that. `isRemote` is kept as
     * corroboration in the source payload and deliberately never consulted
     * here — see the class note for why it cannot mean what its name suggests.
     */
    workMode: workModeFrom(raw.workplaceType),
    /*
     * REMOTE never means worldwide. Ashby states no remote-country
     * eligibility, and a remote posting's `secondaryLocations` are places the
     * job is offered, not a list of countries someone may work from.
     */
    remoteCountriesAllowed: [],
    employmentType: employmentTypeFrom(raw.employmentType),
    // No seniority field exists, and a title is not one.
    seniorityLevel: null,
    salaryMin: pay.min,
    salaryMax: pay.max,
    currency: pay.currency,
    payPeriod: pay.period,
    skills: [],
    /*
     * `department` and `team` are org units — "Engineering", "EMEA
     * Engineering". Storing them as industries would make an internal team
     * name filterable as a sector, so they are not mapped anywhere: the
     * matching schema has no generic field for them and inventing one to hold
     * vendor decoration would be worse than losing it.
     */
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    // `publishedAt` is a start date, not a deadline. The API states none.
    /*
     * `publishedAt` — documented as "ISO DateTime when the job was last
     * published". A publication fact by definition, present on 136 of 136 live
     * postings with an explicit `+00:00` offset.
     *
     * Recorded as LAST_PUBLISHED rather than FIRST_PUBLISHED because that is
     * precisely what the documentation says: for a posting republished after
     * being taken down, this is the later event. Ashby exposes nothing that
     * would reveal whether that happened, so the distinction is preserved in
     * the claim instead of being flattened into a certainty we do not have.
     */
    employerPosted: publicationDate(raw.publishedAt)
      ? {
          at: publicationDate(raw.publishedAt) as Date,
          semantics: 'LAST_PUBLISHED' as const,
        }
      : null,
    expiresAt: null,
    /*
     * `isListed: false` is handled by the PROVIDER, which drops those postings
     * before they reach here — see `ashby.provider.ts`. It is not a closure:
     * the employer has not ended the role, they have unlisted it, and the
     * lifecycle records that as the source going away rather than the job
     * being CLOSED.
     */
    closedAtSource: false,
  };
}

/**
 * Description, from whichever field carries it — through the extractor either
 * way.
 *
 * `descriptionPlain` is not reliably plain: 13 of 584 live postings contained
 * angle brackets in it. "The provider says this is plain text" is a claim
 * about someone else's escaping, and the cost of checking is nothing.
 */
function resolveDescription(raw: AshbyJob): string | null {
  return (
    plainDescription(
      raw.descriptionPlain,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    ) ??
    plainDescription(
      raw.descriptionHtml,
      EXTERNAL_JOB_LIMITS.maxDescriptionLength,
    )
  );
}

/**
 * A structured postal address → country, region, city.
 *
 * Three refusals, all from live data:
 *
 *   - `addressLocality` is an EMPTY STRING on 119 of 584 postings. Empty is
 *     absent, not a city named "".
 *   - `addressCountry` is sometimes not a country: "European Union" appears 22
 *     times. It resolves to nothing rather than to a guess.
 *   - `addressLocality` sometimes repeats the country ("Spain" as both), on 5
 *     live postings. A city that is its own country name is the country said
 *     twice, not a city.
 */
function resolvePlace(address: AshbyPostalAddress | undefined): {
  countryCode: string | null;
  region: string | null;
  city: string | null;
} {
  if (!address) return { countryCode: null, region: null, city: null };

  const countryCode = countryCodeFromName(address.addressCountry);
  const rawCity = text(address.addressLocality, 120);
  const rawRegion = text(address.addressRegion, 120);

  const cityIsCountry =
    rawCity !== null &&
    countryCodeFromName(rawCity) === countryCode &&
    countryCode !== null;

  return {
    countryCode,
    region: rawRegion && rawRegion !== rawCity ? rawRegion : null,
    city: cityIsCountry ? null : rawCity,
  };
}

/**
 * The other places this one posting is open in.
 *
 * Deduplicated against the primary location and against each other, because a
 * board that lists "Germany" twice has not doubled the job. Entries that
 * resolve to nothing at all are dropped rather than stored as three nulls.
 */
function resolveSecondaryLocations(
  raw: AshbyJob,
  primary: ExternalJobLocation,
): ExternalJobLocation[] {
  const entries = Array.isArray(raw.secondaryLocations)
    ? raw.secondaryLocations
    : [];
  const out: ExternalJobLocation[] = [];
  const seen = new Set<string>([keyOf(primary)]);

  for (const entry of entries) {
    const place = resolvePlace(entry?.address?.postalAddress);
    if (!place.countryCode && !place.city && !place.region) continue;
    const key = keyOf(place);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
    if (out.length >= EXTERNAL_JOB_LIMITS.maxRemoteCountries) break;
  }
  return out;
}

function keyOf(place: ExternalJobLocation): string {
  return [place.countryCode ?? '', place.region ?? '', place.city ?? '']
    .join('|')
    .toLowerCase();
}

/**
 * The posted salary — and only a salary.
 *
 * ## What may become one
 *
 * `summaryComponents` is Ashby's own roll-up across tiers, and live data shows
 * it holds AT MOST ONE `Salary` entry (313 postings have exactly one, 271 have
 * none, never two). That single entry is a figure Ashby publishes on the
 * public posting itself, so reading it is reading a stated fact.
 *
 * Bonus, Commission, EquityPercentage and EquityCashValue all appear live and
 * none of them is a salary. An equity percentage is not money per year, and a
 * commission target is not base pay; either one in the salary column would be
 * compared against a candidate's stated range as though the employer had
 * promised it.
 *
 * ## Why multi-currency tiers produce nothing
 *
 * 98 live postings carry several market tiers, 97 of them with different
 * ranges, and 30 with different CURRENCIES. When a posting says
 * "CAD 190–260k in Toronto, USD 150–210k in New York", Ashby's summary picks
 * one currency and drops the other — which is fine as a headline on a page
 * that also shows the tiers, and wrong as the single band this schema would
 * store. A Canadian candidate would be matched against a US figure with no
 * indication that had happened.
 *
 * So: one currency across every stated salary tier, or no salary at all. The
 * amounts are never blended, never averaged, and never converted — the same
 * atomic-claim rule Greenhouse's multi-range and Lever's tiers already follow.
 */
export function resolvePay(raw: AshbyJob): {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: ReturnType<typeof payPeriodFrom>;
  /** Why nothing was stored, when nothing was. For logs and tests. */
  refusedReason: string | null;
} {
  const none = {
    min: null,
    max: null,
    currency: null,
    period: null,
  } as const;

  const compensation = raw.compensation;
  if (!compensation) return { ...none, refusedReason: null };

  const summary = (
    Array.isArray(compensation.summaryComponents)
      ? compensation.summaryComponents
      : []
  ).filter(isSalary);

  if (summary.length === 0) {
    return {
      ...none,
      refusedReason: hasNonSalaryComponent(compensation.summaryComponents)
        ? 'only non-salary compensation stated'
        : null,
    };
  }
  if (summary.length > 1) {
    // Never observed live, and if it happens there is no way to choose.
    return { ...none, refusedReason: 'several salary summaries stated' };
  }

  // Every currency any tier states a SALARY in.
  const tierCurrencies = new Set<string>();
  for (const tier of compensation.compensationTiers ?? []) {
    for (const component of tier?.components ?? []) {
      if (!isSalary(component)) continue;
      const code = currencyCode(component.currencyCode);
      if (code) tierCurrencies.add(code);
    }
  }
  if (tierCurrencies.size > 1) {
    return {
      ...none,
      refusedReason: `salary tiers span ${tierCurrencies.size} currencies`,
    };
  }

  const component = summary[0];
  const currency = currencyCode(component.currencyCode);
  const min = salaryAmount(component.minValue);
  const max = salaryAmount(component.maxValue);

  // An amount with no currency is a number, not a salary; a currency with no
  // amount is nothing at all. Both are how "Offers Bonus" is expressed.
  if (!currency || (min === null && max === null)) {
    return {
      ...none,
      refusedReason: 'salary stated without amount or currency',
    };
  }
  if (min !== null && max !== null && min > max) {
    return { ...none, refusedReason: 'salary floor above its ceiling' };
  }
  if (tierCurrencies.size === 1 && !tierCurrencies.has(currency)) {
    // The roll-up disagrees with the tiers it summarizes. Trust neither.
    return { ...none, refusedReason: 'summary currency disagrees with tiers' };
  }

  return {
    min,
    max,
    currency,
    // "1 YEAR" / "1 MONTH" via the shared dictionary; "NONE" and anything
    // unrecognized leave the period null rather than assuming a year.
    period: payPeriodFrom(component.interval),
    refusedReason: null,
  };
}

function isSalary(component: AshbyCompensationComponent | undefined): boolean {
  return (
    typeof component?.compensationType === 'string' &&
    component.compensationType.trim().toLowerCase() === 'salary'
  );
}

function hasNonSalaryComponent(
  components: AshbyCompensationComponent[] | undefined,
): boolean {
  return (
    Array.isArray(components) &&
    components.some((component) => !isSalary(component))
  );
}

/** `publishedAt`, for callers that want posting age. */
export function ashbyPublishedAt(raw: AshbyJob): Date | null {
  return timestamp(raw.publishedAt);
}
