import { EXTERNAL_JOB_LIMITS } from '../../external-job.limits';
import {
  currencyCode,
  publicationDate,
  safeUrl,
  salaryAmount,
  text,
  timestamp,
} from '../../normalize';
import { urlIdentity } from '../../url-identity';
import {
  employmentTypeFrom,
  payPeriodFrom,
  workModeFrom,
} from '../../vocabulary';
import type { NormalizedExternalJobInput } from '../../external-job.contract';
import type {
  CareersPageJob,
  CompanyCareerSource,
} from './company-careers.types';

/**
 * A company careers observation → the shared contract.
 *
 * ## What this source is actually good at, and what it is not
 *
 * A careers page is the employer publishing a role on their own domain. That
 * makes it the best available evidence for three things — that the company is
 * hiring for this role, what the company calls it, and which domain the
 * company owns — and a poor source for almost everything else, because the
 * structured facts an ATS states in fields are, on a careers page, prose.
 *
 * So this normalizer states little and states it confidently. Location, work
 * mode, seniority, salary and employment type are left null unless a source
 * put them in JSON-LD, and null means "did not say" everywhere downstream,
 * where the ATS sighting attached to the same job answers instead. That
 * division is the whole point of multi-source: the company page contributes
 * provenance and identity, the ATS contributes structure, and neither has to
 * pretend to be the other.
 *
 * ## Two URLs, kept apart on purpose
 *
 *   sourceUrl    the company's own job page       — where this was observed
 *   originalUrl  the ATS application link         — where a candidate applies
 *
 * They are different facts and collapsing them loses one. Storing only the
 * company page would send candidates to a page instead of a form; storing only
 * the ATS link would erase the fact that the employer publishes this role
 * themselves, which is the entire reason this provider exists.
 */

/**
 * Whether a page said anything beyond "there is a job here, called this".
 *
 * ## Why a sighting can be worth REFUSING
 *
 * A careers observation earns its place by tying a company to a requisition.
 * A page that yields only a title and its own URL cannot do that: there is
 * nothing to deduplicate it against, so it can never join the ATS sighting of
 * the same role, and the only row it can ever become is a second copy of a job
 * already in the catalogue — with no description, no location and no apply
 * link. That is worse than not reading the page at all. It is manufactured
 * provenance: a "company careers" source that observed nothing the ATS had not
 * already said, inflating every duplicate-source count into a number that
 * means nothing.
 *
 * ## Found live, not theorised
 *
 * The first real run of this provider created 47 such rows and two duplicate
 * company records. Neither `vercel.com/careers/{slug}` nor
 * `linear.app/careers/{uuid}` publishes its apply link as an `<a href>` — both
 * render the Apply button client-side from a hydration payload — so both
 * sources produced titles with nothing attached. The catalogue went from 1775
 * jobs to 1822 and learned nothing.
 *
 * ## What counts as evidence
 *
 * Anything a listing could not have invented from its own link: an application
 * URL, a description, a place, a salary, an employment type, a work mode, or a
 * stated deadline. One is enough. A company with no ATS at all — applications
 * by email, jobs published nowhere else — still passes on its description or
 * its location, so this refuses duplicates without losing the pages that are
 * genuinely the only record of a role.
 */
export function statesMoreThanItsOwnLink(page: CareersPageJob): boolean {
  return Boolean(
    safeUrl(page.applyUrl) ||
    page.description ||
    page.countryCode ||
    page.region ||
    page.city ||
    page.additionalLocations.length > 0 ||
    page.salaryMin ||
    page.employmentTypeRaw ||
    page.workModeRaw ||
    page.validThrough ||
    page.remoteCountriesAllowed.length > 0,
  );
}

export function normalizeCareersJob(
  page: CareersPageJob,
  source: CompanyCareerSource,
): NormalizedExternalJobInput | null {
  const title = text(page.title, EXTERNAL_JOB_LIMITS.maxTitleLength);
  const pageUrl = safeUrl(page.pageUrl);
  if (!title || !pageUrl) return null;
  // A title and a link is a menu entry, not an observation. See above.
  if (!statesMoreThanItsOwnLink(page)) return null;

  const applyUrl = safeUrl(page.applyUrl);
  /*
   * Identity is the company's own job URL, folded by the shared canonicalizer.
   *
   * Not the title (two openings share one), not the position in the list (a
   * reorder would rewrite every id), and not the ATS id — which this page does
   * not state, only links to. Prefixed with the source id so two configured
   * companies cannot collide on a path as ordinary as `/careers/engineer`.
   */
  const identity = urlIdentity(pageUrl) ?? pageUrl;

  const place = {
    countryCode: page.countryCode,
    region: page.region,
    city: page.city,
  };

  const salaryMin = salaryAmount(page.salaryMin);
  const salaryMax = salaryAmount(page.salaryMax);
  const currency = currencyCode(page.currency);
  const payPeriod = payPeriodFrom(page.payPeriodRaw);
  /*
   * Salary is one statement or nothing.
   *
   * An amount with no currency is a number, and a number with no period could
   * be hourly or annual — a factor of two thousand. Any missing part and the
   * whole claim is dropped, so the ATS's complete claim wins by being the only
   * one, rather than being half-overwritten by a more-trusted fragment.
   */
  const paid = salaryMin !== null && currency !== null && payPeriod !== null;

  return {
    provider: 'COMPANY_CAREERS',
    accessMethod:
      source.index === 'SITEMAP' ? 'PUBLIC_FEED' : 'PUBLIC_ENDPOINT',
    sourceJobId: `${source.sourceId}:${identity}`,
    sourceUrl: pageUrl,
    // Null when the page publishes no application link: the company page is
    // then both the sighting and the destination.
    originalUrl: applyUrl,
    /*
     * The operator's label, not the page's `<title>`. Whoever approved this
     * source named the employer; a page heading is marketing copy that says
     * "Careers at …" as often as it says the company name. JSON-LD is trusted
     * where a source actually publishes `hiringOrganization`.
     */
    companyName:
      text(page.companyName, EXTERNAL_JOB_LIMITS.maxCompanyNameLength) ??
      source.companyLabel,
    /*
     * The strongest company evidence in the catalogue, and the reason no
     * public-suffix parsing appears anywhere in this provider: the domain is
     * STATED by the operator in the approved source, not reduced from whatever
     * host a page happened to be served from. There is no "drop the last two
     * labels" heuristic to get wrong on `company.co.uk`, because nothing is
     * being reduced.
     */
    companyWebsiteUrl:
      safeUrl(page.companyWebsiteUrl) ?? source.companyWebsiteUrl,
    companyCountryCode: null,
    title,
    description: page.description,
    requirementsText: null,
    countryCode: place.countryCode,
    region: place.region,
    city: place.city,
    additionalLocations: page.additionalLocations,
    workMode: workModeFrom(page.workModeRaw),
    // Only what a posting explicitly listed. Empty is unknown, never worldwide.
    remoteCountriesAllowed: page.remoteCountriesAllowed,
    employmentType: employmentTypeFrom(page.employmentTypeRaw),
    /*
     * A careers page states seniority in the title and nowhere else, and
     * reading "Senior" out of a title is the inference this product refuses
     * for every other provider too. Left to the ATS sighting, which has a
     * field for it or does not.
     */
    seniorityLevel: null,
    salaryMin: paid ? salaryMin : null,
    salaryMax: paid ? (salaryMax ?? salaryMin) : null,
    currency: paid ? currency : null,
    payPeriod: paid ? payPeriod : null,
    skills: [],
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    // schema.org `validThrough` when a source publishes one. Never derived
    // from `datePosted`: a posting date says nothing about a deadline.
    /*
     * schema.org `datePosted` — "the date when the employer posted the job".
     * The one field in this whole audit whose publication semantics are
     * defined by a specification rather than inferred from a field name.
     *
     * `dateModified` is never read: a posting edited yesterday was not posted
     * yesterday, and schema.org distinguishes them precisely so that consumers
     * do not confuse the two.
     */
    employerPosted: publicationDate(page.datePosted)
      ? {
          at: publicationDate(page.datePosted) as Date,
          semantics: 'DATE_POSTED' as const,
        }
      : null,
    expiresAt: timestamp(page.validThrough),
    /*
     * A careers page can only ever stop listing a role; it has no vocabulary
     * for "this requisition is closed". Absence is handled by the shared
     * lifecycle, which retires the SOURCE as GONE and leaves the job ACTIVE
     * while the ATS still lists it.
     */
    closedAtSource: false,
  };
}
