import { describe, expect, it } from "vitest";
import {
  safeExternalUrl,
  toExternalJobApplicationPage,
  toExternalJobDetail,
  toExternalJobLifecycle,
  externalTotalPages,
  toExternalJobPlaces,
  toExternalJobReasons,
  toExternalJobResult,
  toExternalJobSearchPage,
  toExternalJobTracking,
  toPostedAt,
  toSavedExternalJobPage,
} from "@/lib/api/external-jobs-adapters";
import type {
  ExternalJobDetailResponse,
  ExternalJobSearchResponse,
  ExternalJobSearchResultResponse,
} from "@/lib/api/contracts";

/**
 * The boundary where a snapshot written months ago meets today's renderer.
 *
 * `reasons` and `additionalLocations` are JSON columns: no DTO checks them on
 * the way out, and a stored search can outlive the code that wrote it. So the
 * question these tests answer is not "does it map the happy path" — it is
 * "what does a candidate see when the shape is wrong", and the answer has to
 * be "one missing chip", never a blank page.
 */

function raw(
  over: Partial<ExternalJobSearchResultResponse> = {},
): ExternalJobSearchResultResponse {
  return {
    externalJobId: "job-1",
    title: "Backend Engineer",
    company: "Acme",
    companyWebsiteUrl: "https://acme.example",
    status: "ACTIVE",
    location: { countryCode: "us", region: null, city: "New York City" },
    additionalLocations: [{ countryCode: "CA", city: "Toronto" }],
    workMode: "REMOTE",
    remoteCountriesAllowed: ["us", "ca"],
    employmentType: "FULL_TIME",
    seniorityLevel: "SENIOR",
    salary: { min: 200000, max: 310000, currency: "usd", payPeriod: "YEARLY" },
    employerPostedAt: "2026-08-20T09:30:00.000Z",
    score: 84,
    band: "STRONG",
    textScore: 90,
    intentScore: 75,
    reasons: [{ code: "LOCATION_EXACT", dimension: "location", state: "MATCH" }],
    applyUrl: "https://jobs.example.org/1",
    provenance: {
      primarySource: "GREENHOUSE",
      applyVia: "GREENHOUSE",
      sourceCount: 1,
    },
    ...over,
  };
}

describe("a well-formed result", () => {
  it("carries every fact the card needs", () => {
    const job = toExternalJobResult(raw());
    expect(job.title).toBe("Backend Engineer");
    expect(job.location.countryCode).toBe("US");
    expect(job.additionalLocations).toEqual([
      { countryCode: "CA", region: null, city: "Toronto" },
    ]);
    expect(job.remoteCountriesAllowed).toEqual(["US", "CA"]);
    expect(job.salary.currency).toBe("USD");
    expect(job.score).toBe(84);
    expect(job.band).toBe("STRONG");
    expect(job.reasons).toHaveLength(1);
  });

  it("keeps the salary the employer posted, unconverted", () => {
    const job = toExternalJobResult(
      raw({
        salary: {
          min: 40_000_000,
          max: null,
          currency: "KRW",
          payPeriod: "YEARLY",
        },
      }),
    );
    expect(job.salary).toEqual({
      min: 40_000_000,
      max: null,
      currency: "KRW",
      payPeriod: "YEARLY",
    });
  });
});

describe("a malformed result", () => {
  it("survives reasons that are not an array", () => {
    for (const reasons of [null, undefined, "LOCATION_EXACT", 42, {}]) {
      expect(toExternalJobReasons(reasons)).toEqual([]);
    }
  });

  it("drops a reason with no code and keeps the rest", () => {
    expect(
      toExternalJobReasons([
        { dimension: "salary", state: "MATCH" },
        null,
        "nonsense",
        { code: "SALARY_UNKNOWN" },
      ]),
    ).toEqual([{ code: "SALARY_UNKNOWN", dimension: "", state: "" }]);
  });

  it("drops a location that says nothing", () => {
    expect(
      toExternalJobPlaces([
        { countryCode: null, region: null, city: null },
        { city: "Toronto" },
        "Toronto",
      ]),
    ).toEqual([{ countryCode: null, region: null, city: "Toronto" }]);
  });

  it("renders no band rather than guessing one", () => {
    // The thresholds live in one versioned policy on the server. A band this
    // build does not recognise is not an invitation to recompute it here.
    expect(toExternalJobResult(raw({ band: "EXCELLENT" })).band).toBeNull();
  });

  it("drops an enum value it does not recognise", () => {
    const job = toExternalJobResult(
      raw({
        workMode: "TELEPATHIC",
        employmentType: "SLAVERY",
        seniorityLevel: "PRINCIPAL",
      }),
    );
    expect(job.workMode).toBeNull();
    expect(job.employmentType).toBeNull();
    expect(job.seniorityLevel).toBeNull();
  });

  it("refuses a salary figure whose currency is missing", () => {
    const job = toExternalJobResult(
      raw({
        salary: { min: 100000, max: null, currency: null, payPeriod: null },
      }),
    );
    // An amount whose money is unknown cannot be displayed truthfully.
    expect(job.salary.min).toBeNull();
    expect(job.salary.currency).toBeNull();
  });

  it("keeps a score inside the scale it claims to be on", () => {
    expect(toExternalJobResult(raw({ score: 1000 })).score).toBe(100);
    expect(toExternalJobResult(raw({ score: -5 })).score).toBe(0);
    expect(
      toExternalJobResult(raw({ score: Number.NaN as unknown as number })).score,
    ).toBe(0);
  });

  it("keeps only real country codes in remote geography", () => {
    const job = toExternalJobResult(
      raw({ remoteCountriesAllowed: ["US", "", "GLOBAL", "ca", 7 as never] }),
    );
    // "GLOBAL" is not a country, and letting it through would be one string
    // edit away from a card that reads "Remote · open to GLOBAL".
    expect(job.remoteCountriesAllowed).toEqual(["US", "CA"]);
  });
});

describe("the apply destination", () => {
  it("passes an ordinary https link through", () => {
    expect(safeExternalUrl("https://jobs.example.org/1")).toBe(
      "https://jobs.example.org/1",
    );
    expect(safeExternalUrl("http://jobs.example.org/1")).toBe(
      "http://jobs.example.org/1",
    );
  });

  it("refuses anything that is not a place to send someone", () => {
    // `javascript:` and `data:` are script execution dressed as navigation;
    // a relative path would send the reader back into this product as though
    // they had applied.
    for (const hostile of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "/jobs/1",
      "jobs.example.org/1",
      "",
      "   ",
      null,
      undefined,
      42,
    ]) {
      expect(safeExternalUrl(hostile)).toBeNull();
    }
  });

  it("leaves a card with no Apply button rather than a bad one", () => {
    expect(toExternalJobResult(raw({ applyUrl: "javascript:alert(1)" })).applyUrl).toBeNull();
    expect(toExternalJobResult(raw({ applyUrl: null })).applyUrl).toBeNull();
  });
});

describe("the page", () => {
  function page(
    over: Partial<ExternalJobSearchResponse> = {},
  ): ExternalJobSearchResponse {
    return {
      runId: "run-1",
      algorithmVersion: "external-search-v1",
      sort: "RELEVANCE",
      asOf: "2026-08-24T06:00:00.000Z",
      applied: {
        query: "Backend Engineer",
        countries: { value: ["ca"], source: "REQUEST" },
        workModes: { value: [], source: "UNSPECIFIED" },
        employmentTypes: { value: [], source: "UNSPECIFIED" },
        seniorityLevels: { value: [], source: "UNSPECIFIED" },
        compensation: { stated: false, source: "UNSPECIFIED" },
      },
      total: 135,
      matched: 135,
      ranked: 135,
      truncated: false,
      page: 1,
      pageSize: 20,
      degraded: false,
      results: [raw()],
      ...over,
    };
  }

  it("keeps both counts, which mean different things", () => {
    const adapted = toExternalJobSearchPage(
      page({ total: 500, matched: 1_200, truncated: true }),
    );
    // `total` is what pagination covers; `matched` is how many jobs answer the
    // filters. Collapsing them would offer pages the API answers with nothing.
    expect(adapted.total).toBe(500);
    expect(adapted.matched).toBe(1_200);
    expect(adapted.truncated).toBe(true);
  });

  it("keeps the per-dimension source, which is how the UI knows what ranked", () => {
    const adapted = toExternalJobSearchPage(
      page({
        applied: {
          ...page().applied,
          countries: { value: ["kr"], source: "PREFERENCE" },
        },
      }),
    );
    expect(adapted.applied.countries).toEqual({
      value: ["KR"],
      source: "PREFERENCE",
    });
  });

  it("treats an unknown source label as unspecified", () => {
    const adapted = toExternalJobSearchPage(
      page({
        applied: {
          ...page().applied,
          countries: { value: [], source: "MAGIC" },
        },
      }),
    );
    expect(adapted.applied.countries.source).toBe("UNSPECIFIED");
  });

  it("never exposes retrieval diagnostics as domain data", () => {
    const adapted = toExternalJobSearchPage(
      page({
        diagnostics: { lexicalCandidates: 135, semanticCandidates: 5 },
      } as Partial<ExternalJobSearchResponse>),
    );
    // Counters for an operator, not facts for a job seeker.
    expect(adapted).not.toHaveProperty("diagnostics");
  });

  it("carries the degraded flag so the UI can say so", () => {
    expect(toExternalJobSearchPage(page({ degraded: true })).degraded).toBe(
      true,
    );
  });
});

describe("the detail", () => {
  function detail(
    over: Partial<ExternalJobDetailResponse> = {},
  ): ExternalJobDetailResponse {
    return {
      externalJobId: "job-1",
      title: "Backend Engineer",
      company: "Acme",
      companyWebsiteUrl: null,
      status: "ACTIVE",
      description: "Build the services.\n\nYou will own delivery.",
      requirementsText: null,
      location: { countryCode: "KR", region: null, city: "Seoul" },
      additionalLocations: [],
      workMode: "HYBRID",
      remoteCountriesAllowed: [],
      employmentType: "FULL_TIME",
      seniorityLevel: null,
      salary: { min: null, max: null, currency: null, payPeriod: null },
      employerPostedAt: null,
      skills: ["Go"],
      industries: [],
      benefits: [],
      languageCodes: ["ko"],
      applyUrl: "https://jobs.example.org/1",
      provenance: {
        primarySource: "LEVER",
        applyVia: "LEVER",
        sourceCount: 1,
      },
      ...over,
    };
  }

  it("carries the description and the stated facts", () => {
    const adapted = toExternalJobDetail(detail());
    expect(adapted.description).toContain("Build the services.");
    expect(adapted.skills).toEqual(["Go"]);
    expect(adapted.languageCodes).toEqual(["ko"]);
  });

  it("carries no score, band or reason", () => {
    // Personalization belongs to the search, which is the only call that knows
    // who is asking. Two candidates open the same job and read the same page.
    const adapted = toExternalJobDetail(detail()) as unknown as Record<
      string,
      unknown
    >;
    for (const field of ["score", "band", "reasons", "textScore", "rank"]) {
      expect(adapted).not.toHaveProperty(field);
    }
  });

  it("keeps Korean exactly as stored", () => {
    const adapted = toExternalJobDetail(
      detail({
        title: "백엔드 개발자",
        description: "백엔드 서비스를 만듭니다.",
      }),
    );
    expect(adapted.title).toBe("백엔드 개발자");
    expect(adapted.description).toBe("백엔드 서비스를 만듭니다.");
  });

  it("tolerates missing array fields", () => {
    const adapted = toExternalJobDetail(
      detail({
        skills: null,
        industries: null,
        benefits: null,
        languageCodes: null,
      }),
    );
    expect(adapted.skills).toEqual([]);
    expect(adapted.benefits).toEqual([]);
  });
});

describe("the publication date", () => {
  it("passes a real timestamp through, normalized to UTC", () => {
    expect(toPostedAt("2026-04-17T09:58:03.000Z")).toBe(
      "2026-04-17T09:58:03.000Z",
    );
    expect(toPostedAt("2026-04-17T05:58:03-04:00")).toBe(
      "2026-04-17T09:58:03.000Z",
    );
  });

  it("drops anything that is not a date", () => {
    // It becomes "Posted 3 days ago" on a card; an unparseable value would
    // render as `Invalid Date`, which is worse than saying nothing.
    for (const bad of [null, undefined, "", "   ", "soon", 42, {}]) {
      expect(toPostedAt(bad)).toBeNull();
    }
  });

  it("carries the date onto the result and the detail", () => {
    expect(
      toExternalJobResult(raw({ employerPostedAt: "2026-08-20T09:30:00Z" }))
        .employerPostedAt,
    ).toBe("2026-08-20T09:30:00.000Z");
    expect(
      toExternalJobResult(raw({ employerPostedAt: null })).employerPostedAt,
    ).toBeNull();
  });

  it("never exposes a crawler timestamp for a client to mistake for it", () => {
    // The response type has no firstSeenAt / lastSeenAt / createdAt, so no
    // component can reach for one when the real date is missing.
    const job = toExternalJobResult(
      raw({
        employerPostedAt: null,
        firstSeenAt: "2026-08-23T00:00:00Z",
        lastSeenAt: "2026-08-24T00:00:00Z",
      } as never),
    ) as unknown as Record<string, unknown>;
    expect(job.employerPostedAt).toBeNull();
    for (const leak of ["firstSeenAt", "lastSeenAt", "createdAt", "updatedAt"]) {
      expect(job).not.toHaveProperty(leak);
    }
  });
});

describe("the applied sort", () => {
  function withSort(sort: string) {
    return toExternalJobSearchPage({
      runId: "run-1",
      algorithmVersion: "external-search-v1",
      sort,
      asOf: "2026-08-24T06:00:00.000Z",
      applied: {
        query: null,
        countries: { value: [], source: "UNSPECIFIED" },
        workModes: { value: [], source: "UNSPECIFIED" },
        employmentTypes: { value: [], source: "UNSPECIFIED" },
        seniorityLevels: { value: [], source: "UNSPECIFIED" },
        compensation: { stated: false, source: "UNSPECIFIED" },
      },
      total: 0,
      matched: 0,
      ranked: 0,
      truncated: false,
      page: 1,
      pageSize: 20,
      degraded: false,
      results: [],
    });
  }

  it("reads the order the backend applied", () => {
    expect(withSort("NEWEST").sort).toBe("NEWEST");
    expect(withSort("RELEVANCE").sort).toBe("RELEVANCE");
  });

  it("falls back to the default for a mode this build cannot render", () => {
    // Better to label the list "Relevance" than to claim an order whose
    // meaning this frontend does not know.
    expect(withSort("SALARY_DESC").sort).toBe("RELEVANCE");
  });

  it("carries the reference instant relative ages are measured from", () => {
    expect(withSort("NEWEST").asOf).toBe("2026-08-24T06:00:00.000Z");
  });
});

/* -------------------------------------------------------------------------- */
/* Saving and self-tracked applications                                        */
/* -------------------------------------------------------------------------- */

describe("personal state on a search result", () => {
  it("reads a job the candidate saved", () => {
    const result = toExternalJobResult({
      ...raw(),
      saved: true,
    });
    expect(result.saved).toBe(true);
    expect(result.tracking).toBeNull();
  });

  it("treats an API that cannot save as not-saved, never as unknown", () => {
    // The search and detail endpoints predate saving; an older backend simply
    // omits the field. "Not saved" is the truth about a build that cannot save
    // anything — and the UI has no words for a third state.
    const result = toExternalJobResult(raw());
    expect(result.saved).toBe(false);
    expect(result.tracking).toBeNull();
  });

  it("never infers saved from a truthy-looking value", () => {
    for (const value of ["true", 1, {}, [], "yes"]) {
      const result = toExternalJobResult({
        ...raw(),
        saved: value as never,
      });
      expect(result.saved).toBe(false);
    }
  });

  it("carries a tracking record through", () => {
    const result = toExternalJobResult({
      ...raw(),
      applicationTracking: {
        id: "track-1",
        status: "INTERVIEW",
        appliedAt: "2026-08-20T09:00:00.000Z",
        note: "Recruiter called",
        updatedAt: "2026-08-21T09:00:00.000Z",
      },
    });
    expect(result.tracking?.status).toBe("INTERVIEW");
    expect(result.tracking?.note).toBe("Recruiter called");
  });
});

describe("toExternalJobTracking", () => {
  const valid = {
    id: "track-1",
    status: "APPLIED",
    appliedAt: "2026-08-20T09:00:00.000Z",
  };

  it("accepts a well-formed record", () => {
    const tracking = toExternalJobTracking(valid);
    expect(tracking).toEqual({
      id: "track-1",
      status: "APPLIED",
      appliedAt: "2026-08-20T09:00:00.000Z",
      note: null,
      // Falls back to appliedAt rather than to the client's clock.
      updatedAt: "2026-08-20T09:00:00.000Z",
    });
  });

  it("drops a record whose status this build cannot localize", () => {
    // Dropped WHOLE, not rendered with a raw key. The job then reads as
    // untracked — recoverable, and nothing false is asserted meanwhile.
    expect(toExternalJobTracking({ ...valid, status: "IN_PROCESS" })).toBeNull();
    expect(toExternalJobTracking({ ...valid, status: "" })).toBeNull();
  });

  it("drops a record with no id, because nothing could be edited on it", () => {
    expect(toExternalJobTracking({ ...valid, id: "" })).toBeNull();
  });

  it("drops a record whose date would render as Invalid Date", () => {
    expect(toExternalJobTracking({ ...valid, appliedAt: "soon" })).toBeNull();
    expect(toExternalJobTracking({ ...valid, appliedAt: "" })).toBeNull();
  });

  it("treats absent and null as untracked", () => {
    expect(toExternalJobTracking(null)).toBeNull();
    expect(toExternalJobTracking(undefined)).toBeNull();
  });

  it("normalizes a blank note to null rather than an empty line", () => {
    expect(toExternalJobTracking({ ...valid, note: "   " })?.note).toBeNull();
  });
});

describe("toExternalJobLifecycle", () => {
  it("passes through every state the catalogue defines", () => {
    for (const status of ["ACTIVE", "STALE", "CLOSED", "EXPIRED", "UNAVAILABLE"]) {
      expect(toExternalJobLifecycle(status)).toBe(status);
    }
  });

  it("falls back to UNAVAILABLE, never to ACTIVE, for an unknown value", () => {
    // Guessing ACTIVE would tell somebody a job is open when nothing said so —
    // and the entire point of showing a saved job's status is that it may have
    // stopped being open.
    expect(toExternalJobLifecycle("SOMETHING_NEW")).toBe("UNAVAILABLE");
    expect(toExternalJobLifecycle(null)).toBe("UNAVAILABLE");
    expect(toExternalJobLifecycle(undefined)).toBe("UNAVAILABLE");
    expect(toExternalJobLifecycle(42)).toBe("UNAVAILABLE");
  });
});

describe("the candidate-owned list envelope", () => {
  it("reads `results`, not `data` — these routes are not Paginated<T>", () => {
    // The mismatch that mattered most: the shared `Paginated<T>` envelope has
    // `{data, meta}`, these routes answer `{page, pageSize, total, asOf,
    // results}`. Reading `.data` produced a permanently empty list with no
    // error anywhere to notice.
    const page = toSavedExternalJobPage({
      page: 2,
      pageSize: 20,
      total: 41,
      asOf: "2026-08-24T00:00:00.000Z",
      results: [],
    });
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(20);
    expect(page.total).toBe(41);
    expect(page.asOf).toBe("2026-08-24T00:00:00.000Z");
  });

  it("derives a page count the API does not send", () => {
    const of = (total: number, pageSize: number) =>
      toSavedExternalJobPage({
        page: 1,
        pageSize,
        total,
        asOf: "2026-08-24T00:00:00.000Z",
        results: [],
      }).totalPages;

    expect(of(0, 20)).toBe(0);
    expect(of(1, 20)).toBe(1);
    expect(of(20, 20)).toBe(1);
    expect(of(21, 20)).toBe(2);
    expect(of(41, 20)).toBe(3);

    // A page size this API cannot send (0, missing, negative) falls back to
    // the known default rather than to 1 — "10 pages of one row" would be a
    // worse lie than "1 page", and the rows actually rendered are whatever
    // `results` held either way.
    expect(of(10, 0)).toBe(1);
    // The pure helper still refuses to divide by a non-positive size, which is
    // what keeps an Infinity out of the pager.
    expect(externalTotalPages(10, 0)).toBe(0);
    expect(externalTotalPages(10, -5)).toBe(0);
  });

  it("uses the backend's read instant rather than inventing one", () => {
    expect(externalTotalPages(41, 20)).toBe(3);
    const page = toSavedExternalJobPage({
      page: 1,
      pageSize: 20,
      total: 0,
      asOf: "not-a-date",
      results: [],
    });
    // An unusable instant never becomes "now": a relative age computed from
    // the client's clock would drift between the server pass and hydration.
    expect(page.asOf).toBe(new Date(0).toISOString());
  });
});

describe("toSavedExternalJobPage", () => {
  const row = {
    externalJobId: "job-1",
    title: "Backend Engineer",
    company: "Acme",
    status: "ACTIVE",
    location: { countryCode: "US", region: null, city: "New York City" },
    workMode: "REMOTE",
    employmentType: "FULL_TIME",
    seniorityLevel: "MID",
    salary: { min: 100, max: 200, currency: "usd", payPeriod: "YEAR" },
    employerPostedAt: "2026-08-01T00:00:00.000Z",
    applyUrl: "https://jobs.example.org/1",
    savedAt: "2026-08-20T09:00:00.000Z",
  };

  const paged = (results: unknown[]) => ({
    page: 1,
    pageSize: 20,
    total: results.length,
    asOf: "2026-08-24T00:00:00.000Z",
    results: results as never,
  });

  it("keeps a closed listing in the list, with its status intact", () => {
    // The single most important behaviour of the saved list: a job that closed
    // must not silently disappear from what the reader deliberately kept.
    const page = toSavedExternalJobPage(paged([{ ...row, status: "CLOSED" }]));
    expect(page.saved).toHaveLength(1);
    expect(page.saved[0].status).toBe("CLOSED");
  });

  it("normalizes the same way the search adapter does", () => {
    const page = toSavedExternalJobPage(paged([row]));
    const job = page.saved[0];
    expect(job.salary.currency).toBe("USD");
    expect(job.workMode).toBe("REMOTE");
    expect(job.applyUrl).toBe("https://jobs.example.org/1");
    // The instant belongs to the PAGE — one per read — not to each row.
    expect(page.asOf).toBe("2026-08-24T00:00:00.000Z");
  });

  it("refuses an apply destination that is not a real http(s) URL", () => {
    for (const applyUrl of ["javascript:alert(1)", "/internal", "", null]) {
      const page = toSavedExternalJobPage(paged([{ ...row, applyUrl }]));
      expect(page.saved[0].applyUrl).toBeNull();
    }
  });

  it("survives an empty page", () => {
    const page = toSavedExternalJobPage(paged([]));
    expect(page.saved).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe("toExternalJobApplicationPage", () => {
  const row = {
    id: "track-1",
    status: "APPLIED",
    appliedAt: "2026-08-20T09:00:00.000Z",
    note: null,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T09:00:00.000Z",
    externalJobId: "job-1",
    job: {
      externalJobId: "job-1",
      title: "Backend Engineer",
      company: "Acme",
      companyWebsiteUrl: null,
      status: "ACTIVE",
      location: { countryCode: "US", region: null, city: "New York City" },
      additionalLocations: [],
      workMode: "REMOTE",
      remoteCountriesAllowed: [],
      employmentType: "FULL_TIME",
      seniorityLevel: "MID",
      salary: { min: null, max: null, currency: null, payPeriod: null },
      employerPostedAt: null,
      applyUrl: "https://jobs.example.org/1",
      provenance: { primarySource: "GREENHOUSE", applyVia: null, sourceCount: 1 },
      saved: false,
    },
  };

  const paged = (results: unknown[]) => ({
    page: 1,
    pageSize: 20,
    total: results.length,
    asOf: "2026-08-24T00:00:00.000Z",
    results: results as never,
  });

  it("reads the listing from the nested `job`, not from the top level", () => {
    // The tracker's own fields are top-level; everything about the LISTING is
    // under `job`. Reading `response.title` gave a row with no title at all.
    const application = toExternalJobApplicationPage(paged([row])).applications[0];
    expect(application.job?.title).toBe("Backend Engineer");
    expect(application.job?.company).toBe("Acme");
    expect(application.job?.applyUrl).toBe("https://jobs.example.org/1");
  });

  it("keeps the listing's lifecycle and the tracked status as separate fields", () => {
    const application = toExternalJobApplicationPage(
      paged([
        { ...row, status: "INTERVIEW", job: { ...row.job, status: "CLOSED" } },
      ]),
    ).applications[0];

    // THE case this separation exists for: the employer stopped advertising,
    // the person already inside their process is still inside it.
    expect(application.status).toBe("INTERVIEW");
    expect(application.job?.status).toBe("CLOSED");
  });

  it("keeps a tracker whose listing has left the catalogue entirely", () => {
    // `job: null`. The candidate still applied; their record is the thing this
    // list exists to keep, and dropping the row would silently delete it.
    const application = toExternalJobApplicationPage(
      paged([{ ...row, job: null }]),
    ).applications[0];

    expect(application.id).toBe("track-1");
    expect(application.status).toBe("APPLIED");
    expect(application.job).toBeNull();
  });

  it("drops a row whose status cannot be localized rather than printing it", () => {
    const page = toExternalJobApplicationPage(
      paged([row, { ...row, id: "track-2", status: "IN_PROCESS" }]),
    );
    // A shorter list is honest; an untranslated enum key is not.
    expect(page.applications.map((a) => a.id)).toEqual(["track-1"]);
  });

  it("reports saved independently of being tracked", () => {
    const untouched = toExternalJobApplicationPage(paged([row]));
    expect(untouched.applications[0].job?.saved).toBe(false);

    const both = toExternalJobApplicationPage(
      paged([{ ...row, job: { ...row.job, saved: true } }]),
    );
    expect(both.applications[0].job?.saved).toBe(true);
  });

  it("carries note and updatedAt when the list provides them", () => {
    const application = toExternalJobApplicationPage(
      paged([{ ...row, note: "Recruiter called", updatedAt: "2026-08-21T09:00:00.000Z" }]),
    ).applications[0];
    expect(application.note).toBe("Recruiter called");
    expect(application.updatedAt).toBe("2026-08-21T09:00:00.000Z");
  });

  it("tolerates the search/detail tracker, which guarantees neither", () => {
    // The decoration on a search result carries only {id, status, appliedAt}.
    // Requiring note or updatedAt there would drop every tracked job from the
    // board.
    const tracking = toExternalJobTracking({
      id: "track-1",
      status: "INTERVIEW",
      appliedAt: "2026-08-20T09:00:00.000Z",
    });
    expect(tracking?.status).toBe("INTERVIEW");
    expect(tracking?.note).toBeNull();
    expect(tracking?.updatedAt).toBe("2026-08-20T09:00:00.000Z");
  });
});
