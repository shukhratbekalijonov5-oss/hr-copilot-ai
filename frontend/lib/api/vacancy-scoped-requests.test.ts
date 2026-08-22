import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The request contracts the vacancy-scoped backend now enforces.
 *
 * Each of these was a live 400/403 before this integration: candidate creation
 * without a vacancy, an AI summary without a vacancy, a candidate Ask without
 * a vacancy, and creator-scoped selectors reading the org-wide catalog. The
 * tests assert the exact path and body that leaves the frontend, so a
 * regression is caught here rather than by a user.
 */

const fetchMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/session", () => ({
  getSessionToken: async () => "test-token",
  getRefreshToken: async () => null,
  setSessionTokens: async () => undefined,
}));

/**
 * A fresh Response per call — a Response body can only be read once, so a
 * single shared instance breaks any test whose code path fetches twice.
 */
function respondWith(body: unknown): () => Promise<Response> {
  return async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

/** The last request's parsed URL + body. */
function lastCall(): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    method: (init.method ?? "GET") as string,
    body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("creator-scoped selectors", () => {
  it("reads /vacancies/mine, never the org-wide catalog", async () => {
    const { getMyVacancies } = await import("@/lib/api/vacancies.service");
    fetchMock.mockImplementation(
      respondWith({
        data: [],
        meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
      }),
    );

    await getMyVacancies();

    expect(lastCall().url).toContain("/vacancies/mine");
    expect(lastCall().url).not.toMatch(/\/vacancies\?/);
  });

  it("reads the pipeline from /vacancies/:id/candidates", async () => {
    const { getVacancyCandidates } = await import("@/lib/api/vacancies.service");
    fetchMock.mockImplementation(
      respondWith({
        data: [],
        meta: { total: 0, page: 1, limit: 100, totalPages: 0 },
      }),
    );

    await getVacancyCandidates("vac-1");

    expect(lastCall().url).toContain("/vacancies/vac-1/candidates");
  });

  it("sends the whole selection to bulk-delete in one all-or-nothing call", async () => {
    const { bulkDeleteVacancies } = await import("@/lib/api/vacancies.service");
    fetchMock.mockImplementation(
      respondWith({ deletedIds: ["v1", "v2"], deletedCount: 2 }),
    );

    await bulkDeleteVacancies(["v1", "v2"]);

    const call = lastCall();
    expect(call.url).toContain("/vacancies/bulk-delete");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ vacancyIds: ["v1", "v2"] });
    // One request, not one per id — partial deletion must be impossible.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the API client offers no candidate-creation surface", () => {
  it("exports neither createCandidate nor an application-association call", async () => {
    const candidates = await import("@/lib/api/candidates.service");
    const applications = await import("@/lib/api/applications.service");

    // The backend routes are gone; a client function for them would only ever
    // produce a 404, and would keep the removed feature alive in the UI.
    expect("createCandidate" in candidates).toBe(false);
    expect("createApplication" in applications).toBe(false);
    // Recruiters have no document surface at all any more: there is nothing
    // to upload onto, and candidate evidence is read exclusively through the
    // vacancy-contextual current-evidence calls. The module specifier is
    // built at runtime because a static one would not compile — which is
    // itself the point.
    const removed = ["@/lib/api", "documents.service"].join("/");
    await expect(import(/* @vite-ignore */ removed)).rejects.toThrow();
    expect("getCandidateCurrentEvidence" in candidates).toBe(true);
    expect("getCandidateCurrentDocumentUrl" in candidates).toBe(true);
  });
});

describe("candidate-detail AI is vacancy-contextual", () => {
  it("sends vacancyId with the summary", async () => {
    const { summariseCandidate } = await import("@/lib/api/ai.service");
    fetchMock.mockImplementation(
      respondWith({
        summary: "…",
        status: "GROUNDED",
        citations: [],
        locale: "en",
        rejectedCitations: [],
        durationMs: 1,
        model: null,
      }),
    );

    await summariseCandidate("cand-1", "vac-1", "ko");

    const call = lastCall();
    expect(call.url).toContain("/ai/candidates/cand-1/summary");
    expect(call.body).toEqual({ vacancyId: "vac-1", locale: "ko" });
  });

  it("sends vacancyId with a candidate Ask", async () => {
    const { answerQuestion } = await import("@/lib/api/ai.service");
    fetchMock.mockImplementation(
      respondWith({
        answer: "…",
        status: "GROUNDED",
        citations: [],
        locale: "en",
        rejectedCitations: [],
        evidenceConsidered: 3,
        durationMs: 1,
        model: null,
      }),
    );

    await answerQuestion({
      query: "backend experience",
      candidateId: "cand-1",
      vacancyId: "vac-1",
      locale: "en",
    });

    expect(lastCall().body).toMatchObject({
      candidateId: "cand-1",
      vacancyId: "vac-1",
    });
  });

  it("keeps the interview-questions route vacancy-scoped", async () => {
    const { getInterviewQuestions } = await import("@/lib/api/ai.service");
    fetchMock.mockImplementation(
      respondWith({
        candidateId: "cand-1",
        vacancyId: "vac-1",
        questions: [],
        locale: "en",
        durationMs: 1,
        model: null,
      }),
    );

    await getInterviewQuestions("cand-1", "vac-1", "en");

    expect(lastCall().url).toContain(
      "/ai/candidates/cand-1/vacancies/vac-1/interview-questions",
    );
  });
});

describe("org-wide surfaces keep the vacancy optional", () => {
  it("omits vacancyId from search when nothing is scoped", async () => {
    const { searchEvidence } = await import("@/lib/api/search.service");
    fetchMock.mockImplementation(
      respondWith({
        query: "x",
        results: [],
        reranked: false,
        totalConsidered: 0,
        durationMs: 1,
      }),
    );

    await searchEvidence({ query: "kubernetes" });
    expect(
      (lastCall().body as { vacancyId?: string }).vacancyId,
    ).toBeUndefined();

    await searchEvidence({ query: "kubernetes", vacancyId: "vac-1" });
    expect((lastCall().body as { vacancyId?: string }).vacancyId).toBe("vac-1");
  });

  it("passes an owned vacancy filter to processing jobs as a query param", async () => {
    const { getProcessingJobs } = await import("@/lib/api/processing.service");
    fetchMock.mockImplementation(
      respondWith({
        data: [],
        meta: { total: 0, page: 1, limit: 100, totalPages: 0 },
      }),
    );

    await getProcessingJobs({ vacancyId: "vac-1" });

    // Processing is document-centric: the vacancy only filters the view.
    const processingCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/processing-jobs"),
    );
    expect(String(processingCall?.[0])).toContain("vacancyId=vac-1");
  });
});
