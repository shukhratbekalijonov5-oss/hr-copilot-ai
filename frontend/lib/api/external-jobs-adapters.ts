/**
 * External job wire shapes → domain types.
 *
 * ## Why this validates instead of casting
 *
 * Two fields arrive as JSON columns — `reasons`, written into a search
 * snapshot when the search ran, and `additionalLocations`, written by whichever
 * provider ingested the posting. Neither is checked by a Nest DTO on the way
 * out, and a snapshot can outlive the code that wrote it. A cast would turn a
 * shape drift into `undefined.map is not a function` on a candidate's screen;
 * a narrow validation turns it into one missing chip.
 *
 * ## Nothing here derives meaning
 *
 * No score is computed, no band threshold is applied, no currency is
 * converted, no reason is invented. Every value below is either passed through
 * or dropped. The one transformation is narrowing a string to a known enum,
 * and an unrecognised value becomes `null` — which the UI renders as silence,
 * not as a guess.
 */
import type {
  ExternalCoverLetterResponse,
  ExternalMatchBreakdownResponse,
  ExternalInterviewPrepResponse,
  ExternalWhyMatchResponse,
  ExternalJobApplicationResponse,
  ExternalPagedResponse,
  SavedExternalJobCardResponse,
  ExternalJobDetailResponse,
  ExternalJobSearchResponse,
  ExternalJobSearchResultResponse,
  ExternalJobTrackingResponse,
  SavedExternalJobResponse,
} from "@/lib/api/contracts";

import {
  EMPLOYMENT_TYPES,
  EXTERNAL_APPLICATION_STATUSES,
  EXTERNAL_JOB_LIFECYCLES,
  EXTERNAL_JOB_SORTS,
  MATCH_BANDS,
  MATCH_BREAKDOWN_STATUSES,
  PAY_PERIODS,
  SENIORITY_LEVELS,
  WORK_MODES,
  type AiInsight,
  type AiInterviewQuestion,
  type EmploymentType,
  type ExternalApplicationStatus,
  type ExternalJobApplication,
  type ExternalJobApplicationPage,
  type ExternalJobDetail,
  type ExternalJobLifecycle,
  type ExternalJobTracking,
  type ExternalJobSort,
  type ExternalJobPlace,
  type ExternalJobReason,
  type ExternalJobResult,
  type ExternalJobSalary,
  type ExternalCoverLetter,
  type ExternalInterviewPrep,
  type ExternalMatchBreakdown,
  type MatchBreakdownDimension,
  type ExternalJobSearchPage,
  type ExternalWhyMatch,
  type JobIntentSource,
  type ExternalTrackedJobCard,
  type SavedExternalJob,
  type SavedExternalJobPage,
  type MatchBand,
  type PayPeriod,
  type SeniorityLevel,
  type WorkMode,
} from "@/lib/types";

/** A posting open in more offices than a card could list is still bounded. */
const MAX_ADDITIONAL_LOCATIONS = 25;
/** Reasons past this many are noise on any screen; the backend caps at 6. */
const MAX_REASONS = 12;

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Uppercased ISO-2 codes only. Anything else is not a country we can label. */
function countryCodes(value: unknown): string[] {
  return strings(value)
    .map((code) => code.toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

/**
 * One place, or nothing.
 *
 * A location object with every part null carries no information, so it is
 * dropped rather than rendered as an empty bullet in a list of offices.
 */
export function toExternalJobPlace(value: unknown): ExternalJobPlace | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const countryCode = text(record.countryCode);
  const place: ExternalJobPlace = {
    countryCode: countryCode ? countryCode.toUpperCase() : null,
    region: text(record.region),
    city: text(record.city),
  };
  if (!place.countryCode && !place.region && !place.city) return null;
  return place;
}

export function toExternalJobPlaces(value: unknown): ExternalJobPlace[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toExternalJobPlace)
    .filter((place): place is ExternalJobPlace => place !== null)
    .slice(0, MAX_ADDITIONAL_LOCATIONS);
}

/**
 * The reason codes, kept as codes.
 *
 * A reason with no code cannot be localized and cannot be tested, so it is
 * dropped here rather than being carried to a component that would have to
 * decide what to do with it.
 */
export function toExternalJobReasons(value: unknown): ExternalJobReason[] {
  if (!Array.isArray(value)) return [];
  const reasons: ExternalJobReason[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const code = text(record.code);
    if (!code) continue;
    reasons.push({
      code,
      dimension: text(record.dimension) ?? "",
      state: text(record.state) ?? "",
    });
    if (reasons.length >= MAX_REASONS) break;
  }
  return reasons;
}

/**
 * Pay, in the employer's own money.
 *
 * A figure with no currency is dropped: an amount whose money is unknown
 * cannot be displayed truthfully, and displaying it beside the reader's own
 * currency symbol would be the app inventing a claim the employer never made.
 */
function toSalary(value: {
  min: number | null;
  max: number | null;
  currency: string | null;
  payPeriod: string | null;
}): ExternalJobSalary {
  const currency = text(value?.currency);
  const min = integer(value?.min);
  const max = integer(value?.max);
  if (!currency || (min === null && max === null)) {
    return { min: null, max: null, currency: null, payPeriod: null };
  }
  return {
    min,
    max,
    currency: currency.toUpperCase(),
    payPeriod: oneOf<PayPeriod>(PAY_PERIODS, value?.payPeriod),
  };
}

/**
 * A publication date, or nothing.
 *
 * Validated rather than passed through: this value becomes "Posted 3 days ago"
 * on a card, and an unparseable string would render as `Invalid Date`. A date
 * the backend could not have meant is dropped, and the card simply says
 * nothing about when the job was posted — which is the same thing it does for
 * the half of the catalogue that genuinely has no date.
 */
export function toPostedAt(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function source(value: unknown): JobIntentSource {
  return value === "REQUEST" || value === "PREFERENCE" ? value : "UNSPECIFIED";
}

export function toExternalJobResult(
  response: ExternalJobSearchResultResponse,
): ExternalJobResult {
  return {
    externalJobId: response.externalJobId,
    title: response.title,
    company: response.company,
    companyWebsiteUrl: text(response.companyWebsiteUrl),
    status: response.status,
    location:
      toExternalJobPlace(response.location) ??
      { countryCode: null, region: null, city: null },
    additionalLocations: toExternalJobPlaces(response.additionalLocations),
    workMode: oneOf<WorkMode>(WORK_MODES, response.workMode),
    remoteCountriesAllowed: countryCodes(response.remoteCountriesAllowed),
    employmentType: oneOf<EmploymentType>(
      EMPLOYMENT_TYPES,
      response.employmentType,
    ),
    seniorityLevel: oneOf<SeniorityLevel>(
      SENIORITY_LEVELS,
      response.seniorityLevel,
    ),
    salary: toSalary(response.salary),
    employerPostedAt: toPostedAt(response.employerPostedAt),
    // Clamped, not recomputed: the backend owns the number, and this only
    // refuses to render one that could not have come from it.
    score: Math.min(100, Math.max(0, integer(response.score) ?? 0)),
    band: oneOf<MatchBand>(MATCH_BANDS, response.band),
    textScore: integer(response.textScore),
    intentScore: integer(response.intentScore),
    reasons: toExternalJobReasons(response.reasons),
    // Only an absolute http(s) URL is a place to send someone. Anything else
    // — a relative path, a javascript: URL, an empty string — is refused, and
    // the card renders without an Apply button instead.
    applyUrl: safeExternalUrl(response.applyUrl),
    // Absent on the wire means "this build cannot save", which is rendered as
    // not-saved rather than as an unknown third state the UI has no words for.
    saved: response.saved === true,
    tracking: toExternalJobTracking(response.applicationTracking),
    provenance: {
      primarySource: text(response.provenance?.primarySource),
      applyVia: text(response.provenance?.applyVia),
      sourceCount: Math.max(0, integer(response.provenance?.sourceCount) ?? 0),
    },
  };
}

/**
 * An apply destination, or nothing.
 *
 * The backend already stores only provider-validated URLs, so this is a second
 * lock on the same door rather than the only one. It exists because this value
 * becomes an `href` a candidate clicks: `javascript:` and `data:` URLs are
 * script execution dressed as navigation, and a relative path would silently
 * send someone back into this product as though they had applied.
 */
export function safeExternalUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function toExternalJobSearchPage(
  response: ExternalJobSearchResponse,
): ExternalJobSearchPage {
  return {
    runId: response.runId,
    algorithmVersion: response.algorithmVersion,
    // The order the backend applied. An unrecognised value falls back to the
    // default rather than being shown as a mode this build cannot render.
    sort:
      (EXTERNAL_JOB_SORTS as readonly string[]).includes(response.sort)
        ? (response.sort as ExternalJobSort)
        : "RELEVANCE",
    // Falls back to the client's own clock only if the backend omitted it,
    // which would mean an older API — a wrong-by-seconds label beats a crash.
    asOf: toPostedAt(response.asOf) ?? new Date().toISOString(),
    applied: {
      query: text(response.applied?.query),
      countries: {
        value: countryCodes(response.applied?.countries?.value),
        source: source(response.applied?.countries?.source),
      },
      workModes: {
        value: strings(response.applied?.workModes?.value),
        source: source(response.applied?.workModes?.source),
      },
      employmentTypes: {
        value: strings(response.applied?.employmentTypes?.value),
        source: source(response.applied?.employmentTypes?.source),
      },
      seniorityLevels: {
        value: strings(response.applied?.seniorityLevels?.value),
        source: source(response.applied?.seniorityLevels?.source),
      },
      compensation: {
        stated: response.applied?.compensation?.stated === true,
        source: source(response.applied?.compensation?.source),
      },
    },
    total: Math.max(0, integer(response.total) ?? 0),
    matched: Math.max(0, integer(response.matched) ?? 0),
    ranked: Math.max(0, integer(response.ranked) ?? 0),
    truncated: response.truncated === true,
    page: Math.max(1, integer(response.page) ?? 1),
    pageSize: Math.max(1, integer(response.pageSize) ?? 20),
    degraded: response.degraded === true,
    results: (response.results ?? []).map(toExternalJobResult),
  };
}

export function toExternalJobDetail(
  response: ExternalJobDetailResponse,
): ExternalJobDetail {
  return {
    externalJobId: response.externalJobId,
    title: response.title,
    company: response.company,
    companyWebsiteUrl: text(response.companyWebsiteUrl),
    status: response.status,
    // Plain text by contract — the backend sanitizes provider HTML at
    // ingestion. It is rendered as text regardless; see the detail component.
    description: text(response.description),
    requirementsText: text(response.requirementsText),
    location:
      toExternalJobPlace(response.location) ??
      { countryCode: null, region: null, city: null },
    additionalLocations: toExternalJobPlaces(response.additionalLocations),
    workMode: oneOf<WorkMode>(WORK_MODES, response.workMode),
    remoteCountriesAllowed: countryCodes(response.remoteCountriesAllowed),
    employmentType: oneOf<EmploymentType>(
      EMPLOYMENT_TYPES,
      response.employmentType,
    ),
    seniorityLevel: oneOf<SeniorityLevel>(
      SENIORITY_LEVELS,
      response.seniorityLevel,
    ),
    salary: toSalary(response.salary),
    employerPostedAt: toPostedAt(response.employerPostedAt),
    skills: strings(response.skills),
    industries: strings(response.industries),
    benefits: strings(response.benefits),
    languageCodes: strings(response.languageCodes),
    applyUrl: safeExternalUrl(response.applyUrl),
    saved: response.saved === true,
    tracking: toExternalJobTracking(response.applicationTracking),
    provenance: {
      primarySource: text(response.provenance?.primarySource),
      applyVia: text(response.provenance?.applyVia),
      sourceCount: Math.max(0, integer(response.provenance?.sourceCount) ?? 0),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Saving and self-tracked applications                                        */
/* -------------------------------------------------------------------------- */

/**
 * The listing's own lifecycle.
 *
 * Falls back to UNAVAILABLE rather than to ACTIVE when the backend sends a
 * value this build does not know. Guessing ACTIVE would tell someone a job is
 * open when nothing said so — and the whole point of showing a saved job's
 * status is that it may have stopped being open. UNAVAILABLE says exactly what
 * is true: we cannot currently vouch for this listing.
 */
export function toExternalJobLifecycle(value: unknown): ExternalJobLifecycle {
  return oneOf<ExternalJobLifecycle>(EXTERNAL_JOB_LIFECYCLES, value) ?? "UNAVAILABLE";
}

/**
 * The candidate's tracking record, or nothing.
 *
 * A record whose status this build cannot localize is dropped WHOLE rather
 * than rendered with a raw enum key. Showing `IN_PROCESS` to a Korean reader
 * is worse than showing nothing: it is untranslated, unexplained, and looks
 * like a bug the reader caused. Dropping it means the job reads as untracked,
 * which is recoverable — they can set the status again — and nothing false is
 * asserted in the meantime.
 *
 * `appliedAt` is validated for the same reason a posting date is: it becomes
 * "Applied 3 days ago", and an unparseable string renders as `Invalid Date`.
 */
export function toExternalJobTracking(
  value: ExternalJobTrackingResponse | null | undefined,
): ExternalJobTracking | null {
  if (!value || typeof value !== "object") return null;

  const id = text(value.id);
  const status = oneOf<ExternalApplicationStatus>(
    EXTERNAL_APPLICATION_STATUSES,
    value.status,
  );
  const appliedAt = toPostedAt(value.appliedAt);
  if (!id || !status || !appliedAt) return null;

  return {
    id,
    status,
    appliedAt,
    note: text(value.note),
    updatedAt: toPostedAt(value.updatedAt) ?? appliedAt,
  };
}

export function toSavedExternalJob(
  response: SavedExternalJobResponse,
): SavedExternalJob {
  return {
    externalJobId: response.externalJobId,
    title: response.title,
    company: response.company,
    status: toExternalJobLifecycle(response.status),
    location:
      toExternalJobPlace(response.location) ??
      { countryCode: null, region: null, city: null },
    additionalLocations: toExternalJobPlaces(response.additionalLocations),
    workMode: oneOf<WorkMode>(WORK_MODES, response.workMode),
    remoteCountriesAllowed: countryCodes(response.remoteCountriesAllowed),
    employmentType: oneOf<EmploymentType>(
      EMPLOYMENT_TYPES,
      response.employmentType,
    ),
    seniorityLevel: oneOf<SeniorityLevel>(
      SENIORITY_LEVELS,
      response.seniorityLevel,
    ),
    salary: toSalary(
      response.salary ?? { min: null, max: null, currency: null, payPeriod: null },
    ),
    employerPostedAt: toPostedAt(response.employerPostedAt),
    applyUrl: safeExternalUrl(response.applyUrl),
    provenance: {
      primarySource: text(response.provenance?.primarySource),
      applyVia: text(response.provenance?.applyVia),
      sourceCount: Math.max(0, integer(response.provenance?.sourceCount) ?? 0),
    },
    // Falls back to the epoch-free "unknown" only if the backend omitted it;
    // the list sorts server-side, so this is a label, not an ordering key.
    savedAt: toPostedAt(response.savedAt) ?? new Date(0).toISOString(),
    tracking: toExternalJobTracking(response.applicationTracking),
  };
}

/**
 * How many pages `total` items make.
 *
 * Derived here because the API reports `total` and `pageSize` and no page
 * count. Deriving it once, next to the only two numbers it depends on, is what
 * stops two list components computing it differently — and a `pageSize` of
 * zero (which the API cannot send, but a proxy could) yields 0 rather than an
 * Infinity that would render an endless pager.
 */
export function externalTotalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 0;
  return Math.ceil(Math.max(0, total) / pageSize);
}

/**
 * The envelope the candidate-owned lists actually use.
 *
 * NOT the shared `Paginated<T>`: these routes answer `{page, pageSize, total,
 * asOf, results}` with no `meta` wrapper. Reading `.data` here would have
 * produced a permanently empty list with no error anywhere — the failure mode
 * this function exists to make impossible.
 */
function externalPageMeta(
  response: ExternalPagedResponse<unknown> | null | undefined,
): { asOf: string; page: number; pageSize: number; total: number; totalPages: number } {
  // Falls back to the backend's own default, not to 1: a bogus size would
  // otherwise report "N pages of one row", which is a worse lie than one page.
  const raw = integer(response?.pageSize);
  const pageSize = raw !== null && raw > 0 ? raw : 20;
  const total = Math.max(0, integer(response?.total) ?? 0);
  return {
    // The BACKEND's read instant. Falls back only if an older API omitted it.
    asOf: toPostedAt(response?.asOf) ?? new Date(0).toISOString(),
    page: Math.max(1, integer(response?.page) ?? 1),
    pageSize,
    total,
    totalPages: externalTotalPages(total, pageSize),
  };
}

export function toSavedExternalJobPage(
  response: ExternalPagedResponse<SavedExternalJobResponse>,
): SavedExternalJobPage {
  return {
    ...externalPageMeta(response),
    saved: (response?.results ?? []).map(toSavedExternalJob),
  };
}

/**
 * One tracked application, or nothing.
 *
 * Built on the same narrowing as `toExternalJobTracking`, so a row whose
 * status this build cannot localize is dropped from the list rather than
 * printed raw. A shorter list is honest; an untranslated enum key is not.
 */
/**
 * The listing behind a tracked application, or nothing.
 *
 * `job` is null when the catalogue no longer holds the posting. That is not an
 * error and the row is not dropped: the candidate still applied, and their own
 * record is the thing this list exists to keep.
 */
export function toExternalTrackedJobCard(
  value: (SavedExternalJobCardResponse & { saved?: boolean }) | null | undefined,
): ExternalTrackedJobCard | null {
  if (!value || typeof value !== "object") return null;
  return {
    externalJobId: value.externalJobId,
    title: value.title,
    company: value.company,
    status: toExternalJobLifecycle(value.status),
    location:
      toExternalJobPlace(value.location) ??
      { countryCode: null, region: null, city: null },
    applyUrl: safeExternalUrl(value.applyUrl),
    // Saved and tracked are independent; this only reports the other fact.
    saved: value.saved === true,
  };
}

export function toExternalJobApplication(
  response: ExternalJobApplicationResponse,
): ExternalJobApplication | null {
  const tracking = toExternalJobTracking(response);
  if (!tracking) return null;

  return {
    ...tracking,
    externalJobId: response.externalJobId,
    job: toExternalTrackedJobCard(response.job),
  };
}

export function toExternalJobApplicationPage(
  response: ExternalPagedResponse<ExternalJobApplicationResponse>,
): ExternalJobApplicationPage {
  return {
    ...externalPageMeta(response),
    applications: (response?.results ?? [])
      .map(toExternalJobApplication)
      .filter((row): row is ExternalJobApplication => row !== null),
  };
}

/* -------------------------------------------------------------------------- */
/* Gemini "why this match"                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Model output, narrowed before it reaches a component.
 *
 * ## Why this adapter is stricter than the others
 *
 * Everything else in this file narrows data an employer or our own ranker
 * produced. This narrows text a language model produced, which differs in two
 * ways that matter: its shape is a strong convention rather than a schema, and
 * its content is untrusted in a way an integer never is.
 *
 * So: an item with no title is dropped rather than rendered as a bullet with a
 * blank heading; whitespace-only strings become absent; the lists are capped;
 * and every value that survives is a plain string. Nothing here produces
 * markup, and nothing downstream is allowed to interpret it as any — the
 * insight type is two plain strings for exactly that reason.
 *
 * ## What is deliberately NOT read
 *
 * No score, confidence, percentage or ranking of any kind, even if the backend
 * one day sends one. The card's number comes from the deterministic ranker and
 * is the only score this product has; a second, model-authored one beside it
 * would leave a reader to decide which to believe.
 */

/** Enough to be useful, few enough to stay scannable. */
const MAX_INSIGHTS = 6;

function toAiInsight(value: unknown): AiInsight | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { title?: unknown; explanation?: unknown };

  // The title carries the point. An item without one is not a shorter item,
  // it is a bullet with nothing to bullet, so it does not survive.
  const title = text(raw.title);
  if (!title) return null;

  return { title, explanation: text(raw.explanation) ?? "" };
}

function toAiInsights(value: unknown): AiInsight[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toAiInsight)
    .filter((insight): insight is AiInsight => insight !== null)
    .slice(0, MAX_INSIGHTS);
}

export function toExternalWhyMatch(
  externalJobId: string,
  response: Partial<ExternalWhyMatchResponse> | null | undefined,
): ExternalWhyMatch {
  return {
    // The id the caller asked about, not the one the body claims. A response
    // that named a different job would otherwise be rendered under this job's
    // title, which is the one mistake this panel must never make.
    externalJobId,
    version: text(response?.version),
    locale: text(response?.locale),
    summary: text(response?.summary),
    strengths: toAiInsights(response?.strengths),
    gaps: toAiInsights(response?.gaps),
    generatedAt: toPostedAt(response?.generatedAt),
    // `cached` is read off the wire type and stops here. Whether Redis had it
    // is not a fact about this job, and a reader has no use for it.
  };
}

/** True when there is nothing worth opening a panel for. */
export function isEmptyWhyMatch(explanation: ExternalWhyMatch): boolean {
  return (
    !explanation.summary &&
    explanation.strengths.length === 0 &&
    explanation.gaps.length === 0
  );
}

/* -------------------------------------------------------------------------- */
/* Cover letter and interview prep                                             */
/* -------------------------------------------------------------------------- */

/**
 * The same narrowing discipline as `toExternalWhyMatch`, applied to the other
 * two generated documents.
 *
 * Same reasons, restated because they are easy to relax one field at a time:
 * the shape is a convention rather than a schema, so an absent field is normal
 * and becomes null; the content is untrusted, so it stays plain strings that
 * downstream renders as text nodes; and no score, confidence or percentage is
 * read from any of them, because the ranker's number is the only number this
 * product has about a job.
 */

/** A letter longer than this is not a letter; something has gone wrong. */
const MAX_COVER_LETTER_CHARS = 12_000;
/** More questions than anyone will read before an interview. */
const MAX_QUESTIONS = 12;

export function toExternalCoverLetter(
  externalJobId: string,
  response: ExternalCoverLetterResponse | null | undefined,
): ExternalCoverLetter {
  const content = text(response?.content);

  return {
    // The id asked about, never the one the body claims — a letter rendered
    // under the wrong job's title is a letter somebody sends to the wrong
    // employer.
    externalJobId,
    version: text(response?.version),
    locale: text(response?.locale),
    subject: text(response?.subject),
    // Truncated rather than refused: a reader with an over-long letter is
    // better served by most of it than by an error, and the cap exists so a
    // runaway generation cannot lock up a drawer.
    content: content ? content.slice(0, MAX_COVER_LETTER_CHARS) : null,
    generatedAt: toPostedAt(response?.generatedAt),
  };
}

export function isEmptyCoverLetter(letter: ExternalCoverLetter): boolean {
  // The body is what makes it a letter. A subject alone is not one.
  return !letter.content;
}

function toInterviewQuestion(value: unknown): AiInterviewQuestion | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    question?: unknown;
    whyAsked?: unknown;
    preparation?: unknown;
  };

  // No question text, no question. The two supporting fields are commentary
  // on it and cannot stand alone.
  const question = text(raw.question);
  if (!question) return null;

  return {
    question,
    whyAsked: text(raw.whyAsked) ?? "",
    preparation: text(raw.preparation) ?? "",
  };
}

/** `{title, guidance}` on the wire → the same `AiInsight` strengths use. */
function toFocusArea(value: unknown): AiInsight | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { title?: unknown; guidance?: unknown };

  const title = text(raw.title);
  if (!title) return null;

  return { title, explanation: text(raw.guidance) ?? "" };
}

export function toExternalInterviewPrep(
  externalJobId: string,
  response: ExternalInterviewPrepResponse | null | undefined,
): ExternalInterviewPrep {
  const questions = Array.isArray(response?.questions)
    ? response.questions
        .map(toInterviewQuestion)
        .filter((item): item is AiInterviewQuestion => item !== null)
        .slice(0, MAX_QUESTIONS)
    : [];

  const focusAreas = Array.isArray(response?.focusAreas)
    ? response.focusAreas
        .map(toFocusArea)
        .filter((item): item is AiInsight => item !== null)
        .slice(0, MAX_INSIGHTS)
    : [];

  return {
    externalJobId,
    version: text(response?.version),
    locale: text(response?.locale),
    questions,
    focusAreas,
    generatedAt: toPostedAt(response?.generatedAt),
  };
}

/**
 * Questions are the point of this feature; focus areas are the extra.
 *
 * So prep with focus areas but no questions counts as empty — it would render
 * as a heading and a short list with the thing the reader pressed the button
 * for missing entirely, which reads as broken rather than as sparse.
 */
export function isEmptyInterviewPrep(prep: ExternalInterviewPrep): boolean {
  return prep.questions.length === 0;
}

/* -------------------------------------------------------------------------- */
/* Advanced match breakdown                                                    */
/* -------------------------------------------------------------------------- */

/** More rows than a drawer can show without becoming a spreadsheet. */
const MAX_DIMENSIONS = 10;
/** Matched/missing lists are evidence, not an inventory. */
const MAX_DIMENSION_ITEMS = 12;

/** Short, non-empty strings only — a bullet with nothing in it is not a bullet. */
function bullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, MAX_DIMENSION_ITEMS);
}

function toBreakdownDimension(value: unknown): MatchBreakdownDimension | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    key?: unknown;
    label?: unknown;
    status?: unknown;
    explanation?: unknown;
    matched?: unknown;
    missing?: unknown;
  };

  /*
   * The LABEL is what makes a row renderable, not the key.
   *
   * `key` is a machine token — `workMode`, `salary` — and rendering one because
   * a label was missing would put a raw code on screen in every locale at once.
   * A row we cannot name honestly is dropped.
   *
   * The key IS translated at render time for the seven dimensions the backend
   * emits (see `breakdownDimensionLabel`), because those labels arrive
   * hardcoded in English. This adapter still keeps the backend's label, which
   * is what any dimension outside that set falls back to.
   */
  const label = text(raw.label);
  if (!label) return null;

  return {
    key: text(raw.key) ?? label,
    label,
    /*
     * An unreadable status becomes UNKNOWN — "nobody stated this" — and never
     * GAP. Reading a value we do not recognise as a deficiency would invent a
     * shortcoming in the reader's profile out of our own parsing failure.
     */
    status: oneOf(MATCH_BREAKDOWN_STATUSES, raw.status) ?? "UNKNOWN",
    explanation: text(raw.explanation) ?? "",
    matched: bullets(raw.matched),
    missing: bullets(raw.missing),
  };
}

export function toExternalMatchBreakdown(
  externalJobId: string,
  response: ExternalMatchBreakdownResponse | null | undefined,
): ExternalMatchBreakdown {
  const dimensions = Array.isArray(response?.dimensions)
    ? response.dimensions
        .map(toBreakdownDimension)
        .filter((item): item is MatchBreakdownDimension => item !== null)
        .slice(0, MAX_DIMENSIONS)
    : [];

  return {
    // The id asked about, never the one the body claims.
    externalJobId,
    version: text(response?.version),
    locale: text(response?.locale),
    summary: text(response?.summary),
    dimensions,
    generatedAt: toPostedAt(response?.generatedAt),
    // No score, weight or percentage is read, even if one is sent: the
    // deterministic ranker owns the only number this product shows about a job.
  };
}

/**
 * The dimensions are the feature; the summary is the preamble.
 *
 * A breakdown with a summary and no rows has broken down nothing — it would
 * render as a heading and a paragraph where the reader expected a table, which
 * reads as a failure rather than as brevity.
 */
export function isEmptyMatchBreakdown(
  breakdown: ExternalMatchBreakdown,
): boolean {
  return breakdown.dimensions.length === 0;
}
