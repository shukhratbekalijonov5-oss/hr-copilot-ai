/**
 * The Lever public Postings API payload, as observed.
 *
 * Every field is optional and loosely typed on purpose. This describes what a
 * third party sent, not a promise about next Tuesday: a provider that changes
 * a type must produce a normalization miss, not a crash mid-sweep.
 *
 * Nothing outside `lever.normalize.ts` may import these types. The moment
 * `hostedUrl` appears anywhere else, the provider abstraction has leaked.
 */

export interface LeverCategories {
  /** A free-text label: "Seoul, South Korea", "New York, NY or Remote". */
  location?: unknown;
  /**
   * TENANT-CONFIGURED free text, not a vendor enum. Live values across three
   * sites include "Full-time", "Full Time", "Temp Full-time", "Fixed Term",
   * "Apprenticeship" and "Full Time/Part Time".
   */
  commitment?: unknown;
  team?: unknown;
  department?: unknown;
  /** Every location this posting is open in. More than one = ambiguous. */
  allLocations?: unknown;
}

/**
 * Amounts in MAJOR units — 150000 means 150,000, not cents. The opposite of
 * Greenhouse's `min_cents`, which is exactly why neither provider gets to
 * decide what a stored salary means.
 */
export interface LeverSalaryRange {
  min?: unknown;
  max?: unknown;
  currency?: unknown;
  /** "per-year-salary", "bi-week-salary", "one-time"… see `vocabulary.ts`. */
  interval?: unknown;
}

/** One of the `lists` sections: a heading plus HTML content. */
export interface LeverList {
  text?: unknown;
  content?: unknown;
}

export interface LeverPosting {
  /** Lever's own posting id. Unique within a site. */
  id?: unknown;
  /** The job title. Lever calls it `text`. */
  text?: unknown;
  categories?: LeverCategories;
  /** ISO 3166-1 alpha-2, stated by Lever as its own field. */
  country?: unknown;
  /** "unspecified" | "onsite" | "on-site" | "remote" | "hybrid". */
  workplaceType?: unknown;
  salaryRange?: LeverSalaryRange;
  /** Prose about the salary. Never parsed. */
  salaryDescription?: unknown;
  salaryDescriptionPlain?: unknown;
  /** Complete description as HTML / plain text. Excludes `lists`. */
  description?: unknown;
  descriptionPlain?: unknown;
  descriptionBody?: unknown;
  descriptionBodyPlain?: unknown;
  opening?: unknown;
  openingPlain?: unknown;
  /** Requirement/benefit sections, NOT included in `description`. */
  lists?: LeverList[];
  additional?: unknown;
  additionalPlain?: unknown;
  /** The Lever-hosted public posting page. */
  hostedUrl?: unknown;
  /** The Lever-hosted application form. */
  applyUrl?: unknown;
  /** Epoch milliseconds. */
  createdAt?: unknown;
}
