import { describe, expect, it } from "vitest";
import {
  EMPTY_EXTERNAL_PARAMS,
  activeFilterCount,
  externalPageCount,
  externalSearchHref,
  hasAnyFilter,
  hasComparableSalary,
  parseSalaryAmount,
  readExternalSearchParams,
  readSort,
  toExternalSearchRequest,
} from "@/lib/candidate/external-job-filters";

/**
 * The URL is user input, and it is the only input this page has.
 *
 * Two properties are worth more than the rest and are asserted from several
 * directions below: an unrecognised value never reaches the API, and a country
 * chosen for this search is the ONLY thing in the request that removes jobs.
 */

describe("reading the URL", () => {
  it("reads a plain search", () => {
    const params = readExternalSearchParams({
      search: "Backend Engineer",
      countries: "CA",
      page: "2",
    });
    expect(params.search).toBe("Backend Engineer");
    expect(params.countries).toEqual(["CA"]);
    expect(params.page).toBe(2);
  });

  it("keeps Korean exactly as typed", () => {
    // No romanisation, no normalisation, no case folding that could damage
    // Hangul. The backend indexes the same characters the reader typed.
    const params = readExternalSearchParams({ search: "백엔드 개발자" });
    expect(params.search).toBe("백엔드 개발자");
  });

  it("accepts a repeated parameter as well as a comma list", () => {
    // Both forms normalize to the vocabulary's own order, so two URLs that
    // mean the same search produce the same request and reuse one snapshot.
    expect(
      readExternalSearchParams({ workModes: ["REMOTE", "HYBRID"] }).workModes,
    ).toEqual(["HYBRID", "REMOTE"]);
    expect(
      readExternalSearchParams({ workModes: "REMOTE,HYBRID" }).workModes,
    ).toEqual(["HYBRID", "REMOTE"]);
  });

  it("drops enum values it does not recognise and keeps the rest", () => {
    // A hand-edited URL narrows the search; it never produces a 400 on a job
    // search, and never reaches a dictionary lookup that would print it raw.
    const params = readExternalSearchParams({
      workModes: "REMOTE,TELEPATHIC",
      employmentTypes: "FULL_TIME,SLAVERY",
      seniorityLevels: "PRINCIPAL",
      payPeriod: "FORTNIGHTLY",
    });
    expect(params.workModes).toEqual(["REMOTE"]);
    expect(params.employmentTypes).toEqual(["FULL_TIME"]);
    expect(params.seniorityLevels).toEqual([]);
    expect(params.payPeriod).toBe("");
  });

  it("keeps only ISO 3166-1 alpha-2 country codes", () => {
    const params = readExternalSearchParams({
      countries: "ca,USA,kr,,X,KR",
    });
    // Uppercased, deduplicated, and anything that is not two letters removed.
    expect(params.countries).toEqual(["CA", "KR"]);
  });

  it("refuses a page that is not a page", () => {
    for (const page of ["0", "-3", "abc", "1.5", ""]) {
      expect(readExternalSearchParams({ page }).page).toBe(1);
    }
    expect(readExternalSearchParams({ page: "999999999" }).page).toBe(10_000);
  });

  it("truncates a query longer than the API accepts", () => {
    const params = readExternalSearchParams({ search: "a".repeat(500) });
    expect(params.search).toHaveLength(200);
  });

  it("caps the country list at the API's own limit", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      String.fromCharCode(65 + (i % 26), 65 + Math.floor(i / 26)),
    ).join(",");
    expect(
      readExternalSearchParams({ countries: many }).countries.length,
    ).toBeLessThanOrEqual(20);
  });
});

describe("salary", () => {
  it("reads an amount and ignores what is not one", () => {
    expect(parseSalaryAmount("120000")).toBe(120000);
    expect(parseSalaryAmount("120,000")).toBe(120000);
    expect(parseSalaryAmount("120 000")).toBe(120000);
    expect(parseSalaryAmount("0")).toBeUndefined();
    expect(parseSalaryAmount("-5")).toBeUndefined();
    expect(parseSalaryAmount("lots")).toBeUndefined();
    expect(parseSalaryAmount("")).toBeUndefined();
  });

  it("is only comparable when the triple is complete", () => {
    const base = { ...EMPTY_EXTERNAL_PARAMS, salaryMin: "120000" };
    // An amount alone cannot be compared with any job's pay — not even with a
    // job posting the same number — so it is not sent.
    expect(hasComparableSalary(base)).toBe(false);
    expect(hasComparableSalary({ ...base, salaryCurrency: "USD" })).toBe(false);
    expect(
      hasComparableSalary({
        ...base,
        salaryCurrency: "USD",
        payPeriod: "YEARLY",
      }),
    ).toBe(true);
  });
});

describe("the API request", () => {
  it("sends the country as the only hard filter", () => {
    const request = toExternalSearchRequest(
      readExternalSearchParams({
        search: "Backend Engineer",
        countries: "CA",
        workModes: "REMOTE",
        seniorityLevels: "SENIOR",
      }),
    );
    expect(request.query).toBe("Backend Engineer");
    expect(request.countries).toEqual(["CA"]);
    // Sent so the backend can ORDER by them. The DTO documents them as soft,
    // and this frontend has no separate opinion about it.
    expect(request.workModes).toEqual(["REMOTE"]);
    expect(request.seniorityLevels).toEqual(["SENIOR"]);
  });

  it("omits an empty dimension instead of sending an empty list", () => {
    const request = toExternalSearchRequest(EMPTY_EXTERNAL_PARAMS);
    // "not asked" lets a saved preference apply; "asked for nothing" would
    // silently override the preferences the candidate took the trouble to save.
    expect(request.query).toBeUndefined();
    expect(request.countries).toBeUndefined();
    expect(request.workModes).toBeUndefined();
    expect(request.employmentTypes).toBeUndefined();
    expect(request.seniorityLevels).toBeUndefined();
    expect(request.minCompensation).toBeUndefined();
  });

  it("never invents a provider filter", () => {
    const request = toExternalSearchRequest(
      readExternalSearchParams({ search: "x", provider: "GREENHOUSE" }),
    );
    expect(request).not.toHaveProperty("provider");
    expect(JSON.stringify(request)).not.toContain("GREENHOUSE");
  });

  it("sends an incomplete salary as nothing at all", () => {
    const request = toExternalSearchRequest(
      readExternalSearchParams({ salaryMin: "120000" }),
    );
    expect(request.minCompensation).toBeUndefined();
  });

  it("sends a complete salary triple", () => {
    const request = toExternalSearchRequest(
      readExternalSearchParams({
        salaryMin: "120,000",
        salaryCurrency: "usd",
        payPeriod: "YEARLY",
      }),
    );
    expect(request.minCompensation).toEqual({
      minAmount: 120000,
      currency: "USD",
      payPeriod: "YEARLY",
    });
  });
});

describe("links", () => {
  it("keeps the whole search when only the page changes", () => {
    const params = readExternalSearchParams({
      search: "Backend Engineer",
      countries: "CA",
      workModes: "REMOTE",
    });
    expect(externalSearchHref(params, { page: 3 })).toBe(
      "/external-jobs?search=Backend+Engineer&countries=CA&workModes=REMOTE&page=3",
    );
  });

  it("resets to page one on any other change", () => {
    const params = readExternalSearchParams({ search: "a", page: "7" });
    // A different result set makes page 7 a page that may not exist, and
    // landing on an empty one reads as "there is nothing" rather than "you
    // moved".
    expect(externalSearchHref(params, { search: "b" })).toBe(
      "/external-jobs?search=b",
    );
  });

  it("is the bare route when nothing is asked", () => {
    expect(externalSearchHref(EMPTY_EXTERNAL_PARAMS)).toBe("/external-jobs");
  });

  it("round-trips through the URL unchanged, Korean included", () => {
    const params = readExternalSearchParams({
      search: "백엔드 개발자",
      countries: "KR,CA",
      employmentTypes: "FULL_TIME",
      salaryMin: "40000000",
      salaryCurrency: "KRW",
      payPeriod: "YEARLY",
      page: "2",
    });
    const href = externalSearchHref(params, { page: params.page });
    const query = Object.fromEntries(
      new URLSearchParams(href.split("?")[1]).entries(),
    );
    expect(readExternalSearchParams(query)).toEqual(params);
  });

  it("carries nothing private", () => {
    // Only what the reader typed or ticked here. Their saved preferences stay
    // on the backend: a shareable link must not carry someone's salary
    // expectations to whoever they send it to.
    const href = externalSearchHref(
      readExternalSearchParams({ search: "Backend Engineer" }),
    );
    for (const leak of ["preference", "intent", "candidate", "account", "run"]) {
      expect(href.toLowerCase()).not.toContain(leak);
    }
  });
});

describe("counters", () => {
  it("counts the dimensions a reader has actually set", () => {
    expect(activeFilterCount(EMPTY_EXTERNAL_PARAMS)).toBe(0);
    expect(
      activeFilterCount(
        readExternalSearchParams({ countries: "CA", workModes: "REMOTE" }),
      ),
    ).toBe(2);
    // An incomplete salary is not a filter, so it is not counted as one.
    expect(
      activeFilterCount(readExternalSearchParams({ salaryMin: "100" })),
    ).toBe(0);
  });

  it("knows whether anything was asked", () => {
    expect(hasAnyFilter(EMPTY_EXTERNAL_PARAMS)).toBe(false);
    expect(hasAnyFilter(readExternalSearchParams({ search: "x" }))).toBe(true);
  });

  it("pages off what the snapshot holds", () => {
    // `total` is what pagination covers. Paging off `matched` — every job
    // answering the filters — would offer pages the API answers with nothing.
    expect(externalPageCount(135, 20)).toBe(7);
    expect(externalPageCount(20, 20)).toBe(1);
    expect(externalPageCount(0, 20)).toBe(0);
    expect(externalPageCount(1, 20)).toBe(1);
  });
});

describe("sort", () => {
  it("defaults to relevance", () => {
    expect(readExternalSearchParams({}).sort).toBe("RELEVANCE");
    expect(toExternalSearchRequest(EMPTY_EXTERNAL_PARAMS).sort).toBe(
      "RELEVANCE",
    );
  });

  it("reads newest from the URL, in either case", () => {
    expect(readSort("newest")).toBe("NEWEST");
    expect(readSort("NEWEST")).toBe("NEWEST");
    expect(readExternalSearchParams({ sort: "newest" }).sort).toBe("NEWEST");
  });

  it("normalizes anything else to the default rather than erroring", () => {
    // A mistyped or hand-edited link should show jobs, not an error page —
    // and the value must never reach the API, which would answer with a 400.
    for (const hostile of [
      "HACK",
      "oldest",
      "score; DROP TABLE external_jobs",
      "",
      undefined,
      ["NEWEST", "HACK"],
    ]) {
      expect(readSort(hostile as string | string[] | undefined)).toBe(
        "RELEVANCE",
      );
    }
  });

  it("keeps the sort out of the URL when it is the default", () => {
    // Two links to the same results should be the same link.
    expect(externalSearchHref(EMPTY_EXTERNAL_PARAMS)).toBe("/external-jobs");
    expect(
      externalSearchHref(readExternalSearchParams({ search: "x" })),
    ).toBe("/external-jobs?search=x");
  });

  it("puts newest in the URL, lower-case", () => {
    expect(
      externalSearchHref(readExternalSearchParams({ search: "x", sort: "newest" })),
    ).toBe("/external-jobs?search=x&sort=newest");
  });

  it("survives a round trip through the URL", () => {
    const params = readExternalSearchParams({
      search: "Backend Engineer",
      countries: "CA",
      sort: "newest",
      page: "2",
    });
    const href = externalSearchHref(params, { page: params.page });
    const query = Object.fromEntries(
      new URLSearchParams(href.split("?")[1]).entries(),
    );
    expect(readExternalSearchParams(query)).toEqual(params);
  });

  it("keeps the sort when only the page changes", () => {
    const params = readExternalSearchParams({ search: "x", sort: "newest" });
    expect(externalSearchHref(params, { page: 2 })).toContain("sort=newest");
  });

  it("keeps every filter when only the sort changes", () => {
    // Changing the order must not silently widen the search.
    const params = readExternalSearchParams({
      search: "Backend Engineer",
      countries: "CA",
      workModes: "REMOTE",
      page: "3",
    });
    const href = externalSearchHref(params, { sort: "NEWEST" });
    expect(href).toContain("search=Backend+Engineer");
    expect(href).toContain("countries=CA");
    expect(href).toContain("workModes=REMOTE");
    expect(href).toContain("sort=newest");
    // A different order is a different list, so page 3 may not exist in it.
    expect(href).not.toContain("page=");
  });

  it("is not counted as a filter", () => {
    // It removes nothing, so it must not appear in "Filters (3)" or make an
    // untouched search look narrowed.
    const params = readExternalSearchParams({ sort: "newest" });
    expect(activeFilterCount(params)).toBe(0);
    expect(hasAnyFilter(params)).toBe(false);
  });
});
