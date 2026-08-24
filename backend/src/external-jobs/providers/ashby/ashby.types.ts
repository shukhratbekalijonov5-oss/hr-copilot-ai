/**
 * The Ashby public Job Postings API payload, as observed.
 *
 * Loosely typed on purpose: this describes what a third party sent, not a
 * promise about next Tuesday. Two things here differ from the published docs
 * and were found by reading real responses:
 *
 *   - `id` EXISTS on every posting (584/584 across seven boards) even though
 *     the documented response shape does not list it. It is a UUID, and it is
 *     what makes a stable source identity possible without parsing URLs.
 *   - `descriptionPlain` is not reliably plain — 13 of 584 contained angle
 *     brackets — so it goes through the same extractor as the HTML.
 *
 * Nothing outside `ashby.normalize.ts` may import these types.
 */

export interface AshbyPostalAddress {
  addressLocality?: unknown;
  addressRegion?: unknown;
  /** A country NAME, and sometimes not a country at all ("European Union"). */
  addressCountry?: unknown;
  postalCode?: unknown;
}

export interface AshbyAddress {
  postalAddress?: AshbyPostalAddress;
}

export interface AshbySecondaryLocation {
  location?: unknown;
  address?: AshbyAddress;
}

/**
 * One line of a compensation package.
 *
 * `compensationType` is the field that matters most in this whole provider:
 * live boards return `Salary`, `Bonus`, `Commission`, `EquityPercentage` and
 * `EquityCashValue`, and only the first is a salary. `interval` is a quantity
 * and a unit ("1 YEAR", "1 MONTH", "NONE").
 */
export interface AshbyCompensationComponent {
  id?: unknown;
  summary?: unknown;
  compensationType?: unknown;
  interval?: unknown;
  currencyCode?: unknown;
  /** Major units. */
  minValue?: unknown;
  maxValue?: unknown;
}

/** One market/zone band. 98 of 584 live postings carry more than one. */
export interface AshbyCompensationTier {
  id?: unknown;
  tierSummary?: unknown;
  title?: unknown;
  additionalInformation?: unknown;
  components?: AshbyCompensationComponent[];
}

export interface AshbyCompensation {
  compensationTierSummary?: unknown;
  scrapeableCompensationSalarySummary?: unknown;
  compensationTiers?: AshbyCompensationTier[];
  /** Ashby's own roll-up across tiers. At most ONE Salary entry, live. */
  summaryComponents?: AshbyCompensationComponent[];
}

export interface AshbyJob {
  /** Undocumented but always present. See the note above. */
  id?: unknown;
  title?: unknown;
  department?: unknown;
  team?: unknown;
  /** "FullTime" | "PartTime" | "Intern" | "Contract" | "Temporary". */
  employmentType?: unknown;
  /** "OnSite" | "Remote" | "Hybrid", or absent. */
  workplaceType?: unknown;
  /**
   * Corroborative only. Live data has `isRemote: true` alongside
   * `workplaceType: "Hybrid"` on 231 of 584 postings, so it does not mean
   * "fully remote" and must never override the structured field.
   */
  isRemote?: unknown;
  /**
   * Whether the posting belongs in a PUBLIC listing. False means reachable by
   * direct link but not to be listed — so it must not become searchable here.
   */
  isListed?: unknown;
  /** Free text: "Remote - European Union", "San Francisco". */
  location?: unknown;
  address?: AshbyAddress;
  secondaryLocations?: AshbySecondaryLocation[];
  descriptionHtml?: unknown;
  descriptionPlain?: unknown;
  publishedAt?: unknown;
  jobUrl?: unknown;
  applyUrl?: unknown;
  compensation?: AshbyCompensation;
  shouldDisplayCompensationOnJobPostings?: unknown;
}

export interface AshbyJobBoard {
  apiVersion?: unknown;
  jobs?: AshbyJob[];
}
