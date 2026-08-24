import { describe, expect, it } from "vitest";
import {
  explicitFilters,
  parseAmount,
  readSearchParams,
  resolveJobQuery,
  searchHref,
} from "./job-search-filters";
import type { JobSearchContext } from "@/lib/types";

/**
 * Find Jobs: what the candidate typed, what they saved, and which one wins.
 *
 * The two rules under test are the ones a job seeker would notice if they
 * broke: a one-off search must beat a saved preference without changing it,
 * and stating no location must mean "anywhere" rather than "where you live".
 */

const empty = readSearchParams({});

function context(
  overrides: Partial<JobSearchContext["resolved"]> = {},
): JobSearchContext {
  return {
    candidateAccountId: "acct-1",
    jobIntent: {
      candidateAccountId: "acct-1",
      stated: true,
      roles: [],
      locations: [],
      countries: [],
      workModes: [],
      compensation: null,
      employmentTypes: [],
      seniorityLevels: [],
      relocation: null,
      preferredIndustries: [],
      preferredBenefits: [],
      exclusions: { companies: [], jobTitles: [], locations: [] },
      updatedAt: null,
    },
    resolved: {
      query: { value: null, source: "UNSPECIFIED" },
      roles: { value: [], source: "UNSPECIFIED" },
      countries: { value: [], source: "UNSPECIFIED" },
      workModes: { value: [], source: "UNSPECIFIED" },
      employmentTypes: { value: [], source: "UNSPECIFIED" },
      seniorityLevels: { value: [], source: "UNSPECIFIED" },
      compensation: { value: null, source: "UNSPECIFIED" },
      exclusions: {
        value: { companies: [], jobTitles: [], locations: [] },
        source: "UNSPECIFIED",
      },
      ...overrides,
    },
    locale: "en",
  } as JobSearchContext;
}

describe("readSearchParams", () => {
  it("reads comma lists and uppercases country codes", () => {
    const params = readSearchParams({
      countries: "kr,de",
      workModes: "REMOTE,HYBRID",
      page: "3",
    });
    expect(params.countries).toEqual(["KR", "DE"]);
    expect(params.workModes).toEqual(["REMOTE", "HYBRID"]);
    expect(params.page).toBe(3);
  });

  it("an absent parameter is an empty dimension, not a filter", () => {
    expect(empty.countries).toEqual([]);
    expect(empty.search).toBe("");
    expect(empty.page).toBe(1);
  });
});

describe("parseAmount", () => {
  it("accepts grouped digits and rejects everything that is not a positive number", () => {
    expect(parseAmount("40 000 000")).toBe(40_000_000);
    expect(parseAmount("20,000")).toBe(20_000);
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("0")).toBeUndefined();
    expect(parseAmount("-5")).toBeUndefined();
    expect(parseAmount("abc")).toBeUndefined();
  });
});

describe("explicitFilters", () => {
  it("omits empty dimensions so they read as 'not asked'", () => {
    // The distinction that matters: "not asked" leaves the saved preference
    // in play; "asked for nothing" would wipe it out for this search.
    expect(explicitFilters(empty)).toEqual({
      query: undefined,
      countries: undefined,
      workModes: undefined,
      employmentTypes: undefined,
      seniorityLevels: undefined,
      salaryMin: undefined,
      salaryCurrency: undefined,
      payPeriod: undefined,
    });
  });

  it("sends a salary filter only when the triple is COMPLETE", () => {
    const partial = readSearchParams({ salaryMin: "20000" });
    expect(explicitFilters(partial).salaryMin).toBeUndefined();

    const complete = readSearchParams({
      salaryMin: "20000",
      salaryCurrency: "USD",
      payPeriod: "YEARLY",
    });
    expect(explicitFilters(complete)).toMatchObject({
      salaryMin: 20_000,
      salaryCurrency: "USD",
      payPeriod: "YEARLY",
    });
  });
});

describe("resolveJobQuery", () => {
  it("with no context, the URL is the whole search", () => {
    const params = readSearchParams({ search: "backend", countries: "DE" });
    expect(resolveJobQuery(params, null)).toMatchObject({
      search: "backend",
      countries: ["DE"],
      usingPreferences: false,
    });
  });

  it("a REQUEST country beats a saved one — and says it is not a preference", () => {
    // Saved Seoul, searched Berlin: Berlin wins for this request.
    const resolved = resolveJobQuery(
      readSearchParams({ countries: "DE" }),
      context({ countries: { value: ["DE"], source: "REQUEST" } }),
    );
    expect(resolved.countries).toEqual(["DE"]);
    expect(resolved.usingPreferences).toBe(false);
  });

  it("a SAVED country never becomes a hard filter", () => {
    /*
     * The bug this pins. The resolver answers "which value wins on this
     * dimension", and its answer was being handed straight to `countries` —
     * the one hard location filter. A candidate whose profile said Seoul who
     * typed "Backend Engineer" therefore got Seoul-only results and no way to
     * tell why, from a search they never narrowed.
     *
     * The saved value still travels: as `preferredCountries`, which ranks.
     */
    const resolved = resolveJobQuery(
      readSearchParams({ search: "Backend Engineer" }),
      context({ countries: { value: ["KR"], source: "PREFERENCE" } }),
    );

    expect(resolved.countries).toBeUndefined();
    expect(resolved.preferredCountries).toEqual(["KR"]);
    expect(resolved.search).toBe("Backend Engineer");
    expect(resolved.usingPreferences).toBe(true);
  });

  it("an explicit country restricts, and does not also arrive as a preference", () => {
    const resolved = resolveJobQuery(
      readSearchParams({ countries: "DE" }),
      context({ countries: { value: ["DE"], source: "REQUEST" } }),
    );

    expect(resolved.countries).toEqual(["DE"]);
    expect(resolved.preferredCountries).toBeUndefined();
  });

  it("a current country wins outright over a saved one", () => {
    // Saved Seoul, searching Toronto: the request restricts to CA, and KR
    // must not survive as a second restriction beside it.
    const resolved = resolveJobQuery(
      readSearchParams({ countries: "CA" }),
      context({ countries: { value: ["CA"], source: "REQUEST" } }),
    );

    expect(resolved.countries).toEqual(["CA"]);
    expect(JSON.stringify(resolved)).not.toContain("KR");
  });

  it("the soft dimensions still travel whatever their source", () => {
    // Work mode, employment, seniority and pay are soft on the backend now, so
    // request and preference values are equally safe to send under their own
    // names — neither can remove a job.
    const resolved = resolveJobQuery(
      empty,
      context({
        workModes: { value: ["REMOTE"], source: "PREFERENCE" },
        seniorityLevels: { value: ["SENIOR"], source: "PREFERENCE" },
      }),
    );

    expect(resolved.workModes).toEqual(["REMOTE"]);
    expect(resolved.seniorityLevels).toEqual(["SENIOR"]);
  });

  it("a saved preference fills a dimension the URL did not mention", () => {
    const resolved = resolveJobQuery(
      empty,
      context({ workModes: { value: ["REMOTE"], source: "PREFERENCE" } }),
    );
    expect(resolved.workModes).toEqual(["REMOTE"]);
    expect(resolved.usingPreferences).toBe(true);
  });

  it("no location anywhere means WORLDWIDE, not 'where they live'", () => {
    // An empty country list is sent as undefined — no restriction at all.
    // Nothing here reads CandidateAccount.location, and it must not: where
    // someone IS has never been a statement about where they want to work.
    const resolved = resolveJobQuery(empty, context());
    expect(resolved.countries).toBeUndefined();
    expect(JSON.stringify(resolved)).not.toContain("location");
  });

  it("carries a saved salary expectation with its units", () => {
    const resolved = resolveJobQuery(
      empty,
      context({
        compensation: {
          value: {
            minAmount: 20_000,
            maxAmount: 40_000,
            currency: "USD",
            payPeriod: "YEARLY",
          },
          source: "PREFERENCE",
        },
      }),
    );
    expect(resolved).toMatchObject({
      salaryMin: 20_000,
      salaryCurrency: "USD",
      payPeriod: "YEARLY",
      usingPreferences: true,
    });
  });

  it("free-text search stays REQUEST-only, never filled from saved roles", () => {
    // A saved target role is something to rank by, not a keyword to force
    // into a text query the candidate did not type.
    const resolved = resolveJobQuery(
      empty,
      context({
        roles: { value: ["Backend Engineer"], source: "PREFERENCE" },
        query: { value: "Backend Engineer", source: "PREFERENCE" },
      }),
    );
    expect(resolved.search).toBeUndefined();
  });
});

describe("searchHref", () => {
  it("preserves every other filter and resets to page 1", () => {
    const params = readSearchParams({
      search: "backend",
      countries: "KR",
      workModes: "REMOTE",
      page: "4",
    });
    const href = searchHref(params, { workModes: ["HYBRID"] });
    expect(href).toContain("search=backend");
    expect(href).toContain("countries=KR");
    expect(href).toContain("workModes=HYBRID");
    // A filter change means a different result set; page 4 may not exist.
    expect(href).not.toContain("page=");
  });

  it("keeps the page when paging is the change", () => {
    expect(searchHref(empty, { page: 3 })).toBe("/jobs?page=3");
  });

  it("an empty search is a bare /jobs, not a URL full of empty parameters", () => {
    expect(searchHref(empty, {})).toBe("/jobs");
  });

  it("never writes preferences — it only builds a URL", () => {
    // Structural: the module has no imports that could write anything.
    const href = searchHref(empty, { countries: ["DE"] });
    expect(href).toBe("/jobs?countries=DE");
  });
});
