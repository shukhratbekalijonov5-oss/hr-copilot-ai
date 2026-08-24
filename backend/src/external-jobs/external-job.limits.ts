/**
 * Bounds on what a provider payload may contain.
 *
 * Every provider response is untrusted input from a third party we do not
 * control. These are not tuning knobs — they are the difference between one
 * bad upstream response and a database full of megabyte descriptions, so they
 * are code constants rather than environment variables: a deployment must not
 * be able to widen them by accident.
 */
export const EXTERNAL_JOB_LIMITS = {
  /** Longer titles are truncated, not rejected: the job is still real. */
  maxTitleLength: 300,
  maxCompanyNameLength: 300,
  /**
   * Descriptions are the one genuinely large field. 200k characters is far
   * beyond any real posting and still small enough that a page of results
   * cannot exhaust memory.
   */
  maxDescriptionLength: 200_000,
  maxRequirementsLength: 50_000,
  maxUrlLength: 2_048,
  /** Per-list caps, so one payload cannot store ten thousand "skills". */
  maxSkills: 100,
  maxIndustries: 30,
  maxLanguageCodes: 20,
  maxRemoteCountries: 250,
  maxVisaTypes: 30,
  maxTagLength: 120,
  /**
   * Salary sanity. Major units, so this spans a ₩1 hourly rate through a
   * multi-billion-won annual figure; anything outside is a parsing error at
   * the source, not a salary, and storing it would poison every comparison it
   * touches. The upper bound is also below PostgreSQL's INTEGER ceiling
   * (2,147,483,647), which is what the column can physically hold.
   */
  minSalary: 1,
  maxSalary: 2_000_000_000,
  /** A posting dated further ahead than this is a bad timestamp, not a job. */
  maxExpiryYearsAhead: 5,
  /**
   * How far ahead of now a PUBLICATION date may sit before it is refused.
   *
   * Not zero, because a small forward skew is legitimate rather than a bug:
   * a date-only value is anchored at 12:00 UTC (see `publicationDate`), so a
   * publisher on the far side of the date line can honestly stamp a calendar
   * date that is still "tomorrow" in UTC, and provider clocks drift. Two days
   * absorbs both.
   *
   * Beyond it the value is a provider defect — and the cost of accepting one
   * is a card that reads "Posted in 3 days", which is worse than no date.
   */
  maxPostedAtSkewMs: 2 * 24 * 60 * 60 * 1000,
} as const;

/**
 * How much of a canonical job one provider's word is worth.
 *
 * Higher wins a field conflict. The ordering is about PROXIMITY TO THE
 * EMPLOYER, not about which site is nicer: a company's own careers page and
 * the ATS that powers it are the employer speaking, while an aggregator is
 * repeating what it read, often days later and often lossily.
 *
 * This decides canonical URLs and field conflicts and NOTHING about how well a
 * job suits a candidate. A job on a lower-trust source is not a worse job, and
 * letting trust touch the match score would quietly rank employers by which
 * ATS they bought.
 */
export const SOURCE_TRUST: Record<string, number> = {
  COMPANY_CAREERS: 100,
  GREENHOUSE: 90,
  LEVER: 90,
  ASHBY: 90,
  NINEHIRE: 90,
  WANTED: 50,
  SARAMIN: 50,
  JOBKOREA: 50,
  OTHER: 10,
};

/** Trust for a provider, defaulting low for anything unrecognized. */
export function sourceTrust(provider: string): number {
  return SOURCE_TRUST[provider] ?? 0;
}
