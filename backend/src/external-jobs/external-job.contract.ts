import type {
  EmploymentType,
  ExternalAccessMethod,
  ExternalProvider,
  JobBenefit,
  PayPeriod,
  SeniorityLevel,
  VisaSponsorship,
  WorkMode,
} from '../generated/prisma/enums';

/**
 * The ONE shape every external provider produces.
 *
 * ## Why this type is the whole point of the provider layer
 *
 * Greenhouse returns `offices[]` and `metadata[]`; Lever returns
 * `categories.location`; Ashby returns `address.postalAddress`; Ninehire will
 * return something Korean and different again. If any of that reached the
 * matcher, "which jobs suit this candidate" would be answered by code that
 * knows what a Greenhouse office is — and adding the fifth provider would mean
 * editing the ranking.
 *
 * So a provider's ONLY job is to produce this, and everything downstream —
 * dedupe, merge, lifecycle, features, scoring — is written against it and has
 * no idea who produced it. The vocabulary is deliberately the same one
 * `Vacancy` uses (WorkMode, EmploymentType, SeniorityLevel, PayPeriod,
 * ISO-4217, ISO 3166-1 alpha-2), because an external job and an internal one
 * have to be comparable without a translation layer between them.
 *
 * ## Absence is a value here
 *
 * Every optional field means "the source did not say", and that is never
 * upgraded to a guess. A Seoul address does not imply `visaSponsorship: NO`; a
 * job titled "Senior Engineer" does not imply `seniorityLevel: SENIOR` unless
 * the source has a seniority field. Inventing either would put a candidate in
 * front of a job they cannot take, or hide one they could.
 */
export interface NormalizedExternalJobInput {
  // -- Provenance ----------------------------------------------------------
  provider: ExternalProvider;
  accessMethod: ExternalAccessMethod;
  /** The provider's own id, when it issues one. */
  sourceJobId: string | null;
  /** Where this was read. Absolute http(s). */
  sourceUrl: string;
  /** The apply/detail page, when the source distinguishes it from sourceUrl. */
  originalUrl: string | null;

  // -- Company -------------------------------------------------------------
  companyName: string;
  /** A company URL the source stated. Never guessed from the job URL. */
  companyWebsiteUrl: string | null;
  /** ISO 3166-1 alpha-2 of the company's home country, when stated. */
  companyCountryCode: string | null;

  // -- Role ----------------------------------------------------------------
  title: string;
  /** Plain text. Any provider HTML is stripped before it gets here. */
  description: string | null;
  requirementsText: string | null;

  // -- Structured ----------------------------------------------------------
  countryCode: string | null;
  region: string | null;
  city: string | null;
  /**
   * Other places this ONE posting is genuinely open in.
   *
   * Not a duplicate of the primary location and not remote eligibility — a
   * single requisition an employer will fill in any of several offices. Ashby
   * states these outright (248 of 584 live postings carry them); Greenhouse
   * and Lever have no equivalent field and leave this empty.
   *
   * It exists because the alternative is worse. The canonical columns hold ONE
   * city, so a posting open in New York, San Francisco and Toronto has to pick
   * one — and once it has, a future location filter would exclude the Toronto
   * candidate the employer would happily have hired. Keeping the rest of the
   * truth costs one nullable column; throwing it away costs someone a job they
   * were eligible for, invisibly.
   *
   * Nothing reads it yet. It is stored so that Task 4C can, rather than
   * discovering the data was discarded three tasks ago.
   */
  additionalLocations: ExternalJobLocation[];
  workMode: WorkMode | null;
  /** Only when the source lists them. Empty = unknown, never worldwide. */
  remoteCountriesAllowed: string[];
  employmentType: EmploymentType | null;
  seniorityLevel: SeniorityLevel | null;

  // -- Compensation, in the source's own currency --------------------------
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: PayPeriod | null;

  // -- Optional signals ----------------------------------------------------
  skills: string[];
  industries: string[];
  benefits: JobBenefit[];
  languageCodes: string[];

  // -- Work authorization, only if explicitly stated ------------------------
  visaSponsorship: VisaSponsorship;
  existingWorkAuthorizationRequired: boolean | null;
  eligibleVisaTypes: string[];

  // -- Publication ---------------------------------------------------------
  /**
   * When the EMPLOYER's source says this listing was published.
   *
   * The timestamp and the KIND of publication event travel together, as one
   * value, for the same reason salary does: a resolver must never be able to
   * take the instant from one source and the semantics from another. Null
   * means the source states no publication date — which is the majority case
   * and is never upgraded to a guess.
   *
   * Providers may only fill this from a field whose documented or
   * self-evident meaning is PUBLICATION. A record-creation time, a
   * last-modified time and a crawler observation are all different facts, and
   * `external-jobs.md` records the audit that decided each provider.
   */
  employerPosted: EmployerPostedClaim | null;

  // -- Lifecycle hints the source gave -------------------------------------
  /** The posting's own deadline, when it states one. */
  expiresAt: Date | null;
  /** True only when the source says the posting is closed/filled. */
  closedAtSource: boolean;
}

/**
 * Which publication event a source's date names.
 *
 * Kept alongside the timestamp rather than flattened away, because the
 * providers genuinely differ and the difference is invisible in the number:
 *
 *   FIRST_PUBLISHED  the first time this listing went live (Greenhouse
 *                    `first_published`). Unaffected by later edits.
 *   LAST_PUBLISHED   the most recent publication of this listing (Ashby
 *                    `publishedAt`, documented as "when the job was last
 *                    published"). Moves if a posting is republished.
 *   DATE_POSTED      schema.org `datePosted` — "the date when the employer
 *                    posted the job", with no first/last distinction.
 *
 * For a listing published once — nearly all of them — the three name the same
 * instant. They diverge only for republished postings, which no provider here
 * flags, so the divergence cannot be detected and must not be pretended away.
 * Storing which one a claim used keeps the nuance auditable instead of
 * inventing a precision the sources do not have.
 */
export type PostingDateSemantics =
  'FIRST_PUBLISHED' | 'LAST_PUBLISHED' | 'DATE_POSTED';

export interface EmployerPostedClaim {
  at: Date;
  semantics: PostingDateSemantics;
}

/** One place a job can be worked, as a source stated it. */
export interface ExternalJobLocation {
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

/** One page of provider results, plus how to ask for the next one. */
export interface ProviderFetchPage {
  jobs: NormalizedExternalJobInput[];
  /**
   * Which listing this page belongs to, in the provider's own terms — a
   * Greenhouse board token, a Lever site, a company feed. Opaque above the
   * provider; the ingestion layer only ever compares it to itself.
   *
   * It exists so absence can be reasoned about at the right granularity.
   * Sweeping board A says nothing about board B's postings, and a run that
   * treated "everything I fetched" as one universe would mark every other
   * board's jobs GONE the moment one board was synced alone.
   */
  scopeKey: string;
  /**
   * Whether this scope was enumerated COMPLETELY and verifiably.
   *
   * Not "the provider claims to be complete" — a fact the provider checked.
   * Greenhouse returns `meta.total` alongside the array, so completeness is
   * an equality it can assert rather than an assumption. A provider that
   * cannot prove it says false, and absence then implies nothing at all.
   */
  complete: boolean;
  /**
   * Opaque to everything but the provider that issued it. Null ends the sweep.
   * A cursor rather than a page number because most job APIs are keyset-based
   * and an offset walk over a changing list silently skips postings.
   */
  nextCursor: string | null;
  /**
   * Postings this provider returned that could not be normalized, with a
   * reason. Surfaced rather than thrown: one malformed job must not cost the
   * other four hundred (see error isolation in the ingestion service).
   */
  rejected: { sourceJobId: string | null; reason: string }[];
}

/** What a provider needs said about it before it may run. */
export interface ExternalProviderDescriptor {
  provider: ExternalProvider;
  accessMethod: ExternalAccessMethod;
  /**
   * The hosts this provider is permitted to contact. An allowlist rather than
   * a blocklist: ingestion runs server-side, and a provider that could be
   * pointed at an arbitrary host is an SSRF primitive with a scheduler
   * attached.
   */
  allowedHosts: string[];
  /** Simultaneous in-flight requests this provider tolerates. */
  maxConcurrency: number;
  /** Minimum gap between requests, in ms. */
  minRequestIntervalMs: number;
  /**
   * How long a job may go unseen before it is STALE. Per provider because the
   * sweep cadences differ: a daily feed and an hourly API mean different things
   * by "I did not see it this time".
   */
  stalenessMs: number;
  /**
   * Whether a job's absence from a full, successful listing is evidence it
   * closed. False for providers that paginate unstably or return partial sets,
   * where absence proves nothing.
   */
  absenceImpliesClosed: boolean;
}
