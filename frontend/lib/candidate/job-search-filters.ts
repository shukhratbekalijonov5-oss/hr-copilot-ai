import type { JobSearchContext } from "@/lib/types";

/**
 * Turning URL parameters and saved preferences into ONE effective search.
 *
 * ## The precedence, and why it lives here
 *
 * `explicit request → saved preference → no restriction`, per dimension. The
 * backend owns that rule (`resolveJobSearchIntent`); this module's job is to
 * read the URL, hand the explicit half to that resolver, and turn what comes
 * back into query parameters for the public job endpoint. It deliberately
 * does not re-implement the precedence — one interpretation of a candidate's
 * intent, not two that drift.
 *
 * ## Searching never writes
 *
 * Nothing here saves anything. A candidate who searches Toronto today still
 * has Seoul saved tomorrow: an ad-hoc search is a question, not a change of
 * mind, and quietly rewriting their profile because they looked at one job
 * would be the product putting words in their mouth.
 *
 * ## No location stated means no restriction
 *
 * An empty country list is "anywhere" — worldwide — and never "only where
 * they live now". The candidate's factual `CandidateAccount.location` is not
 * consulted at all: where someone IS has never been a statement about where
 * they want to work.
 */

/** Exactly what the URL carries. Every field optional; empty is unrestricted. */
export interface JobSearchParams {
  search: string;
  location: string;
  countries: string[];
  workModes: string[];
  employmentTypes: string[];
  seniorityLevels: string[];
  salaryMin: string;
  salaryCurrency: string;
  payPeriod: string;
  page: number;
}

const text = (value: string | string[] | undefined): string =>
  typeof value === "string" ? value.trim() : "";

const list = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string" || !value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export function readSearchParams(
  params: Record<string, string | string[] | undefined>,
): JobSearchParams {
  return {
    search: text(params.search),
    location: text(params.location),
    countries: list(params.countries).map((code) => code.toUpperCase()),
    workModes: list(params.workModes),
    employmentTypes: list(params.employmentTypes),
    seniorityLevels: list(params.seniorityLevels),
    salaryMin: text(params.salaryMin),
    salaryCurrency: text(params.salaryCurrency),
    payPeriod: text(params.payPeriod),
    page: Number(text(params.page)) || 1,
  };
}

/** A positive integer, or undefined — never NaN and never 0. */
export function parseAmount(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[\s,]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

/**
 * The explicit half of the search, in the shape the search-context endpoint
 * takes. Empty dimensions are omitted so the resolver reads them as "not
 * asked" rather than "asked for nothing".
 */
export function explicitFilters(params: JobSearchParams) {
  const amount = parseAmount(params.salaryMin);
  return {
    query: params.search || undefined,
    countries: params.countries.length > 0 ? params.countries : undefined,
    workModes: params.workModes.length > 0 ? params.workModes : undefined,
    employmentTypes:
      params.employmentTypes.length > 0 ? params.employmentTypes : undefined,
    seniorityLevels:
      params.seniorityLevels.length > 0 ? params.seniorityLevels : undefined,
    // The triple is only a filter when it is complete.
    salaryMin:
      amount && params.salaryCurrency && params.payPeriod ? amount : undefined,
    salaryCurrency:
      amount && params.salaryCurrency && params.payPeriod
        ? params.salaryCurrency
        : undefined,
    payPeriod:
      amount && params.salaryCurrency && params.payPeriod
        ? params.payPeriod
        : undefined,
  };
}

export interface ResolvedJobQuery {
  search?: string;
  location?: string;
  /** HARD — a location chosen for THIS search. Request-only. */
  countries?: string[];
  /** SOFT — a saved location preference. Ranks; never restricts. */
  preferredCountries?: string[];
  workModes?: string[];
  employmentTypes?: string[];
  seniorityLevels?: string[];
  salaryMin?: number;
  salaryCurrency?: string;
  payPeriod?: string;
  /** True when at least one dimension came from a saved preference. */
  usingPreferences: boolean;
}

/**
 * The effective query for the public job endpoint.
 *
 * `context` is what the backend resolved (request over preference, per
 * dimension); when it is null — an anonymous visitor, or a candidate with no
 * preferences — the explicit parameters stand alone, which is exactly the
 * "no restriction" case.
 */
export function resolveJobQuery(
  params: JobSearchParams,
  context: JobSearchContext | null,
): ResolvedJobQuery {
  const amount = parseAmount(params.salaryMin);
  if (!context) {
    return {
      search: params.search || undefined,
      location: params.location || undefined,
      countries: params.countries.length > 0 ? params.countries : undefined,
      workModes: params.workModes.length > 0 ? params.workModes : undefined,
      employmentTypes:
        params.employmentTypes.length > 0 ? params.employmentTypes : undefined,
      seniorityLevels:
        params.seniorityLevels.length > 0 ? params.seniorityLevels : undefined,
      salaryMin:
        amount && params.salaryCurrency && params.payPeriod
          ? amount
          : undefined,
      salaryCurrency:
        amount && params.salaryCurrency && params.payPeriod
          ? params.salaryCurrency
          : undefined,
      payPeriod:
        amount && params.salaryCurrency && params.payPeriod
          ? params.payPeriod
          : undefined,
      usingPreferences: false,
    };
  }

  const resolved = context.resolved;
  const fromPreference = [
    resolved.countries,
    resolved.workModes,
    resolved.employmentTypes,
    resolved.seniorityLevels,
    resolved.compensation,
  ].some((dimension) => dimension?.source === "PREFERENCE");

  const compensation = resolved.compensation?.value ?? null;

  /*
   * Location is the one dimension where WHERE the value came from changes what
   * it MEANS, so the two cases travel in different parameters.
   *
   * A country picked for this search restricts: the person said they want to
   * work there. A country sitting in their saved profile does not — someone
   * whose preferences say Seoul who types "Backend Engineer" is asking about
   * backend engineering, and answering with Seoul-only results silently
   * narrows a search they never narrowed. It ranks Seoul first instead.
   *
   * Sending both under `countries` was exactly that bug: the resolver's job is
   * to say which value wins, and passing its answer to a hard filter turned
   * every saved location into a hidden restriction.
   */
  const savedCountries =
    resolved.countries?.source === "PREFERENCE"
      ? (resolved.countries.value ?? [])
      : [];

  return {
    // Free-text search and the legacy location box are REQUEST-only: a saved
    // role is a preference to rank by, not a keyword to force into a query.
    search: params.search || undefined,
    location: params.location || undefined,
    countries: params.countries.length > 0 ? params.countries : undefined,
    preferredCountries:
      savedCountries.length > 0 ? savedCountries : undefined,
    workModes:
      resolved.workModes?.value && resolved.workModes.value.length > 0
        ? resolved.workModes.value
        : undefined,
    employmentTypes:
      resolved.employmentTypes?.value &&
      resolved.employmentTypes.value.length > 0
        ? resolved.employmentTypes.value
        : undefined,
    seniorityLevels:
      resolved.seniorityLevels?.value &&
      resolved.seniorityLevels.value.length > 0
        ? resolved.seniorityLevels.value
        : undefined,
    salaryMin: compensation?.minAmount,
    salaryCurrency: compensation?.currency,
    payPeriod: compensation?.payPeriod,
    usingPreferences: fromPreference,
  };
}

/** The URL for a filter change, preserving everything else and resetting paging. */
export function searchHref(
  params: JobSearchParams,
  changes: Partial<JobSearchParams>,
): string {
  const next = { ...params, ...changes };
  const query = new URLSearchParams();
  if (next.search) query.set("search", next.search);
  if (next.location) query.set("location", next.location);
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
  // A filter change means a different result set; keeping page 5 would land
  // the reader on a page that may no longer exist.
  const page = changes.page ?? 1;
  if (page > 1) query.set("page", String(page));
  const qs = query.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}
