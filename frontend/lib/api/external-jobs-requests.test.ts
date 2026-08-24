import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The exact request each external-jobs call puts on the wire.
 *
 * Every mismatch this integration fixed was invisible from inside the
 * frontend: `limit` instead of `pageSize` was silently ignored, and reading
 * `.data` off an envelope that has `results` produced an empty list with no
 * error anywhere. Neither would fail a type check, and neither would throw.
 *
 * So the contract is pinned here — method, path, query and body — against the
 * shapes the live API was observed to accept and return. A future rename
 * breaks this file rather than a candidate's saved list.
 */

const fetchMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/session", () => ({
  getSessionToken: async () => "test-token",
  getRefreshToken: async () => null,
  setSessionTokens: async () => undefined,
}));

function respondWith(body: unknown, status = 200): () => Promise<Response> {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

function lastCall(): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    method: (init.method ?? "GET") as string,
    body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
  };
}

/** The envelope the live API actually answers with. */
const emptyPage = { page: 1, pageSize: 20, total: 0, asOf: "2026-08-24T00:00:00.000Z", results: [] };

const JOB = "051eb2d9-2db1-4105-9303-a6f098a09488";
const TRACKER = "57587c24-dcda-4583-bfe0-0c6732de4e1f";
const whyMatchResponse = {
  jobId: JOB,
  version: "external-why-match-v1",
  locale: "en",
  summary: "This role lines up with your backend experience.",
  strengths: [
    { title: "Backend systems", explanation: "The posting emphasizes API work." },
  ],
  gaps: [],
  cached: true,
  generatedAt: "2026-08-24T09:00:00.000Z",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving", () => {
  it("POSTs to the job's own save path", async () => {
    const { saveExternalJob } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(
      respondWith({ externalJobId: JOB, saved: true, savedAt: "2026-08-24T00:00:00.000Z" }),
    );

    const result = await saveExternalJob(JOB);

    const call = lastCall();
    expect(call.method).toBe("POST");
    expect(call.url).toContain(`/candidate-account/me/external-jobs/${JOB}/save`);
    expect(result.saved).toBe(true);
  });

  it("DELETEs the same path to unsave", async () => {
    const { unsaveExternalJob } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith({ externalJobId: JOB, saved: false }));

    const result = await unsaveExternalJob(JOB);

    expect(lastCall().method).toBe("DELETE");
    expect(lastCall().url).toContain(`/external-jobs/${JOB}/save`);
    expect(result.saved).toBe(false);
  });

  it("believes the server's boolean over the request that was sent", async () => {
    const { saveExternalJob } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith({ externalJobId: JOB, saved: false }));
    expect((await saveExternalJob(JOB)).saved).toBe(false);
  });
});

describe("the saved list", () => {
  it("asks with pageSize, not limit", async () => {
    // `limit` is what the REST of this API speaks; these routes do not, and a
    // `limit` was accepted and ignored — the page size silently stayed 20.
    const { getSavedExternalJobs } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith(emptyPage));

    await getSavedExternalJobs(3, 50);

    const url = new URL(lastCall().url);
    expect(url.pathname).toContain("/candidate-account/me/external-jobs/saved");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("pageSize")).toBe("50");
    expect(url.searchParams.get("limit")).toBeNull();
  });

  it("reads `results` off the envelope the API actually sends", async () => {
    const { getSavedExternalJobs } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(
      respondWith({
        page: 2,
        pageSize: 20,
        total: 25,
        asOf: "2026-08-24T00:00:00.000Z",
        results: [
          {
            externalJobId: JOB,
            title: "Backend Engineer",
            company: "Acme",
            status: "CLOSED",
            location: { countryCode: "US", region: null, city: "NYC" },
            additionalLocations: [],
            workMode: null,
            remoteCountriesAllowed: [],
            employmentType: null,
            seniorityLevel: null,
            salary: { min: null, max: null, currency: null, payPeriod: null },
            employerPostedAt: null,
            applyUrl: null,
            provenance: { primarySource: null, applyVia: null, sourceCount: 0 },
            savedAt: "2026-08-24T00:00:00.000Z",
            applicationTracking: null,
          },
        ],
      }),
    );

    const page = await getSavedExternalJobs();

    expect(page.saved).toHaveLength(1);
    // A closed listing stays in the list, honestly labelled.
    expect(page.saved[0].status).toBe("CLOSED");
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(2);
  });
});

describe("tracking", () => {
  it("POSTs the status to the job's application path", async () => {
    const { trackExternalApplication } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(
      respondWith(
        { id: TRACKER, status: "APPLIED", appliedAt: "2026-08-24T00:00:00.000Z", note: null },
        201,
      ),
    );

    const tracking = await trackExternalApplication(JOB, { status: "APPLIED" });

    const call = lastCall();
    expect(call.method).toBe("POST");
    expect(call.url).toContain(`/external-jobs/${JOB}/application`);
    expect(call.body).toEqual({ status: "APPLIED" });
    expect(tracking?.id).toBe(TRACKER);
  });

  it("PATCHes the TRACKER id, not the job id", async () => {
    // Two different id spaces on two different path families. Sending the job
    // id here would 404 on every status change.
    const { updateExternalApplication } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(
      respondWith({ id: TRACKER, status: "INTERVIEW", appliedAt: "2026-08-24T00:00:00.000Z" }),
    );

    await updateExternalApplication(TRACKER, { status: "INTERVIEW" });

    const call = lastCall();
    expect(call.method).toBe("PATCH");
    expect(call.url).toContain(
      `/candidate-account/me/external-job-applications/${TRACKER}`,
    );
    expect(call.body).toEqual({ status: "INTERVIEW" });
  });

  it("sends note: null explicitly, which is how the backend clears it", async () => {
    // Omitting `note` leaves it alone; null clears it. The distinction is the
    // backend's, and the frontend must not collapse the two.
    const { updateExternalApplication } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(
      respondWith({ id: TRACKER, status: "APPLIED", appliedAt: "2026-08-24T00:00:00.000Z", note: null }),
    );

    await updateExternalApplication(TRACKER, { note: null });
    expect(lastCall().body).toEqual({ note: null });
  });

  it("DELETEs by tracker id", async () => {
    const { deleteExternalApplication } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith({ id: TRACKER, deleted: true }));

    await deleteExternalApplication(TRACKER);

    expect(lastCall().method).toBe("DELETE");
    expect(lastCall().url).toContain(`/external-job-applications/${TRACKER}`);
  });

  it("passes the status filter and pageSize to the tracking list", async () => {
    const { getExternalApplications } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith(emptyPage));

    await getExternalApplications(2, 20, "INTERVIEW");

    const url = new URL(lastCall().url);
    expect(url.pathname).toContain("/candidate-account/me/external-job-applications");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("pageSize")).toBe("20");
    expect(url.searchParams.get("status")).toBe("INTERVIEW");
  });

  it("omits the status filter entirely when there is none", async () => {
    const { getExternalApplications } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith(emptyPage));

    await getExternalApplications();

    expect(new URL(lastCall().url).searchParams.get("status")).toBeNull();
  });
});

describe('the "why this match" generation request', () => {
  it("POSTs to the job's own why-match path", async () => {
    const { explainExternalMatch } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith(whyMatchResponse));

    await explainExternalMatch(JOB, "ko");

    const call = lastCall();
    // POST, not GET: generation is not a safe cacheable read — it spends a
    // rate-limited model budget, and a GET invites a prefetch or a link
    // scanner to spend it for nobody.
    expect(call.method).toBe("POST");
    expect(new URL(call.url).pathname).toBe(
      `/api/candidate-account/me/external-jobs/${JOB}/why-match`,
    );
  });

  it("sends the locale so the prose matches the screen", async () => {
    const { explainExternalMatch } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith({ ...whyMatchResponse, locale: "ru" }));

    await explainExternalMatch(JOB, "ru");

    expect(lastCall().body).toEqual({ locale: "ru" });
  });

  it("sends nothing but the locale — no profile, resume or prompt", async () => {
    const { explainExternalMatch } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith(whyMatchResponse));

    await explainExternalMatch(JOB);

    const body = lastCall().body as Record<string, unknown>;
    // The backend owns the prompt and reads the candidate's evidence
    // server-side. Nothing about the reader travels from the browser, and no
    // model instruction is assembled here.
    expect(body).toEqual({});
  });

  it("makes exactly one request per call", async () => {
    const { explainExternalMatch } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith(whyMatchResponse));

    await explainExternalMatch(JOB, "en");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("adapts the real backend response envelope", async () => {
    const { explainExternalMatch } = await import("@/lib/api/external-jobs.service");
    fetchMock.mockImplementation(respondWith(whyMatchResponse));

    const result = await explainExternalMatch(JOB, "en");

    expect(result).toMatchObject({
      externalJobId: JOB,
      version: "external-why-match-v1",
      locale: "en",
      summary: "This role lines up with your backend experience.",
      strengths: [
        { title: "Backend systems", explanation: "The posting emphasizes API work." },
      ],
      gaps: [],
      generatedAt: "2026-08-24T09:00:00.000Z",
    });
    expect(result).not.toHaveProperty("cached");
  });
});
