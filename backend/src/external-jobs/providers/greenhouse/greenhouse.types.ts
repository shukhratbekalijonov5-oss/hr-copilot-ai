/**
 * The Greenhouse Job Board API payload, as observed.
 *
 * Every field is optional and `unknown`-ish on purpose. This is a description
 * of what a third party sent, not a promise about what it will send next
 * Tuesday: a provider that changes a type must produce a normalization miss,
 * not a runtime crash in the middle of a sweep.
 *
 * Nothing outside `greenhouse.normalize.ts` may import these types. The moment
 * `absolute_url` appears anywhere else, the provider abstraction has leaked.
 */

export interface GreenhouseLocation {
  name?: unknown;
}

export interface GreenhouseOffice {
  id?: unknown;
  name?: unknown;
  /** "London, England, United Kingdom" — a country NAME, not a code. */
  location?: unknown;
}

export interface GreenhouseDepartment {
  id?: unknown;
  name?: unknown;
}

export interface GreenhouseMetadata {
  id?: unknown;
  name?: unknown;
  value?: unknown;
  value_type?: unknown;
}

/**
 * A pay-transparency range. Note `min_cents`/`max_cents`: MINOR units, so a
 * $139,200 salary arrives as 13920000 and storing it unscaled would tell the
 * matcher this job pays fourteen million dollars.
 */
export interface GreenhousePayRange {
  min_cents?: unknown;
  max_cents?: unknown;
  currency_type?: unknown;
  title?: unknown;
  blurb?: unknown;
}

export interface GreenhouseJob {
  /** The job POST id. Stable, and the one to key on. */
  id?: unknown;
  /**
   * The underlying requisition id. Deliberately NOT used as identity: live
   * data shows two differently-titled posts sharing one, so treating it as a
   * job key would merge distinct openings.
   */
  internal_job_id?: unknown;
  title?: unknown;
  absolute_url?: unknown;
  updated_at?: unknown;
  first_published?: unknown;
  requisition_id?: unknown;
  company_name?: unknown;
  location?: GreenhouseLocation;
  offices?: GreenhouseOffice[];
  departments?: GreenhouseDepartment[];
  metadata?: GreenhouseMetadata[];
  /** HTML, entity-encoded. Present only when `content=true` was requested. */
  content?: unknown;
  application_deadline?: unknown;
  pay_input_ranges?: GreenhousePayRange[];
}

export interface GreenhouseJobList {
  jobs?: GreenhouseJob[];
  meta?: { total?: unknown };
}
