import {
  EMPLOYMENT_TYPES,
  EXTERNAL_JOB_SORTS,
  PAY_PERIODS,
  SENIORITY_LEVELS,
  WORK_MODES,
  type ExternalJobSort,
} from "@/lib/types";
import type { ExternalJobSearchRequest } from "@/lib/api/external-jobs.service";

/**
 * The external search, as it lives in the URL.
 *
 * ## Why the URL and not component state
 *
 * A search someone can share, bookmark and reach again with the back button is
 * worth more than a slightly snappier interaction. It also means the results
 * are rendered on the server from parameters the server can see, so the page a
 * reader loads and the page they return to are produced by the same code.
 *
 * The parameter NAMES match the internal job board (`search`, `countries`,
 * `workModes`, …) on purpose: a reader who moves between the two boards should
 * not need to learn a second convention, and neither should the next person
 * reading this repository.
 *
 * ## Nothing private goes in the URL
 *
 * Only what the reader typed or ticked on this page. Their saved job
 * preferences stay on the backend, which resolves them per request — a
 * shareable link must not carry someone's salary expectations to whoever they
 * send it to.
 *
 * ## Everything is validated, because a URL is user input
 *
 * A hand-edited `workModes=REMOTE,HACK` keeps REMOTE and drops the rest; an
 * unknown enum never reaches the API, and never reaches a dictionary lookup
 * that would print it raw on the screen. Dropping is deliberate over
 * rejecting: an unusable filter should quietly not apply, not turn a job
 * search into an error page.
 */

export const EXTERNAL_PAGE_SIZE = 20;

export interface ExternalJobSearchParams {
  search: string;
  /** HARD — chosen for THIS search. ISO 3166-1 alpha-2, uppercase. */
  countries: string[];
  /** SOFT — these rank; they never remove a job. */
  workModes: string[];
  employmentTypes: string[];
  seniorityLevels: string[];
  salaryMin: string;
  salaryCurrency: string;
  payPeriod: string;
  /**
   * How to order the results. NOT a filter: it removes nothing.
   *
   * Lower-case in the URL because a reader may see it, uppercase on the wire
   * because that is the API's vocabulary. An unrecognised value normalizes to
   * the default rather than erroring — a shared link with a mangled sort
   * should show jobs, not an error page.
   */
  sort: ExternalJobSort;
  page: number;
}

export const EMPTY_EXTERNAL_PARAMS: ExternalJobSearchParams = {
  search: "",
  countries: [],
  workModes: [],
  employmentTypes: [],
  seniorityLevels: [],
  salaryMin: "",
  salaryCurrency: "",
  payPeriod: "",
  sort: "RELEVANCE",
  page: 1,
};

/** The backend caps a query at 200 characters; a longer one is not a search. */
const MAX_QUERY_LENGTH = 200;
/** The backend caps the country list at 20. */
const MAX_COUNTRIES = 20;

function text(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => list(item));
  if (typeof value !== "string" || !value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Keeps only values the API vocabulary contains, in the vocabulary's order. */
function knownOnly(values: string[], allowed: readonly string[]): string[] {
  const chosen = new Set(values.map((value) => value.toUpperCase()));
  return allowed.filter((value) => chosen.has(value));
}

function validCountries(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const code = value.toUpperCase();
    // ISO 3166-1 alpha-2 or nothing. The API rejects anything else with a 400,
    // and a 400 on a job search reads as a broken product, not as a typo.
    if (!/^[A-Z]{2}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= MAX_COUNTRIES) break;
  }
  return out;
}

export function readExternalSearchParams(
  params: Record<string, string | string[] | undefined>,
): ExternalJobSearchParams {
  const page = Number(text(params.page));
  return {
    search: text(params.search).slice(0, MAX_QUERY_LENGTH),
    countries: validCountries(list(params.countries)),
    workModes: knownOnly(list(params.workModes), WORK_MODES),
    employmentTypes: knownOnly(list(params.employmentTypes), EMPLOYMENT_TYPES),
    seniorityLevels: knownOnly(list(params.seniorityLevels), SENIORITY_LEVELS),
    salaryMin: text(params.salaryMin),
    salaryCurrency: /^[A-Za-z]{3}$/.test(text(params.salaryCurrency))
      ? text(params.salaryCurrency).toUpperCase()
      : "",
    payPeriod: knownOnly([text(params.payPeriod)], PAY_PERIODS)[0] ?? "",
    sort: readSort(params.sort),
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

/**
 * The sort, normalized.
 *
 * `?sort=HACK` becomes RELEVANCE. Silently, and on purpose: an unusable sort
 * is not a reason to refuse someone a job search, and the alternative — a 400
 * from the API — turns a mistyped link into a broken product.
 */
export function readSort(value: string | string[] | undefined): ExternalJobSort {
  const raw = text(value).toUpperCase();
  return (EXTERNAL_JOB_SORTS as readonly string[]).includes(raw)
    ? (raw as ExternalJobSort)
    : "RELEVANCE";
}

/** A positive integer, or undefined — never NaN, never 0, never negative. */
export function parseSalaryAmount(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[\s,]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  // The API's own ceiling. A larger number is a typo, and sending it would
  // fail validation rather than filter anything.
  return Math.min(Math.floor(parsed), 2_000_000_000);
}

/**
 * True when the salary inputs form something that can be compared.
 *
 * An amount with no currency cannot be compared with any job's pay — not even
 * with a job posting the same number — so the triple is used only when it is
 * complete. Guessing the reader's currency would be the app putting money in
 * their mouth.
 */
export function hasComparableSalary(params: ExternalJobSearchParams): boolean {
  return Boolean(
    parseSalaryAmount(params.salaryMin) &&
      params.salaryCurrency &&
      params.payPeriod,
  );
}

/** True when the reader has asked for anything at all. */
export function hasAnyFilter(params: ExternalJobSearchParams): boolean {
  return Boolean(
    params.search ||
      params.countries.length ||
      params.workModes.length ||
      params.employmentTypes.length ||
      params.seniorityLevels.length ||
      params.salaryMin,
  );
}

/** True when anything other than the text query is set — the "Filters (3)" count. */
export function activeFilterCount(params: ExternalJobSearchParams): number {
  return (
    (params.countries.length > 0 ? 1 : 0) +
    (params.workModes.length > 0 ? 1 : 0) +
    (params.employmentTypes.length > 0 ? 1 : 0) +
    (params.seniorityLevels.length > 0 ? 1 : 0) +
    (hasComparableSalary(params) ? 1 : 0)
  );
}

/**
 * The API request.
 *
 * The hard/soft split of the product is visible in the shape: `query` and
 * `countries` decide which jobs exist for this search; everything else is sent
 * so the backend can ORDER them. An empty dimension is omitted rather than
 * sent as `[]`, so the resolver reads it as "not asked" instead of "asked for
 * nothing" — and can then fall back to a saved preference, which is exactly
 * the behaviour a candidate expects from preferences they took the trouble to
 * save.
 */
export function toExternalSearchRequest(
  params: ExternalJobSearchParams,
): ExternalJobSearchRequest {
  const amount = parseSalaryAmount(params.salaryMin);
  return {
    query: params.search || undefined,
    countries: params.countries.length ? params.countries : undefined,
    workModes: params.workModes.length ? params.workModes : undefined,
    employmentTypes: params.employmentTypes.length
      ? params.employmentTypes
      : undefined,
    seniorityLevels: params.seniorityLevels.length
      ? params.seniorityLevels
      : undefined,
    minCompensation:
      amount && params.salaryCurrency && params.payPeriod
        ? {
            minAmount: amount,
            currency: params.salaryCurrency,
            payPeriod: params.payPeriod,
          }
        : undefined,
    sort: params.sort,
    page: params.page,
    pageSize: EXTERNAL_PAGE_SIZE,
  };
}

/**
 * The URL for a change, keeping everything else.
 *
 * Any change other than `page` resets to page 1: a different result set makes
 * page 5 a page that may not exist, and landing on an empty one reads as
 * "there is nothing" rather than "you moved".
 */
export function externalSearchHref(
  params: ExternalJobSearchParams,
  changes: Partial<ExternalJobSearchParams> = {},
): string {
  const next = { ...params, ...changes };
  const query = new URLSearchParams();
  if (next.search) query.set("search", next.search);
  if (next.countries.length) query.set("countries", next.countries.join(","));
  if (next.workModes.length) query.set("workModes", next.workModes.join(","));
  if (next.employmentTypes.length) {
    query.set("employmentTypes", next.employmentTypes.join(","));
  }
  if (next.seniorityLevels.length) {
    query.set("seniorityLevels", next.seniorityLevels.join(","));
  }
  if (next.salaryMin) query.set("salaryMin", next.salaryMin);
  if (next.salaryCurrency) query.set("salaryCurrency", next.salaryCurrency);
  if (next.payPeriod) query.set("payPeriod", next.payPeriod);
  // The default is the absence of the parameter, so a plain relevance search
  // has a clean URL and two links to the same results are the same link.
  if (next.sort !== "RELEVANCE") query.set("sort", next.sort.toLowerCase());

  const page = changes.page ?? 1;
  if (page > 1) query.set("page", String(page));

  const qs = query.toString();
  return qs ? `/external-jobs?${qs}` : "/external-jobs";
}

/**
 * How many pages the stored ranking actually covers.
 *
 * Built from `total` — what the snapshot holds — and never from `matched`,
 * which counts every job answering the filters including ones the retrieval
 * funnel did not rank. Paging off the larger number offers pages the API
 * would answer with nothing.
 */
export function externalPageCount(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}
