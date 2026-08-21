import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runEvidenceSearch,
  runGroundedAnswer,
} from "@/lib/search/grounded-search";
import { ApiError, networkError } from "@/lib/api/errors";
import type { EvidenceSearchResult, GroundedAnswer } from "@/lib/types";

/**
 * The recruiter search fans one query into two calls — POST /search/evidence
 * and POST /ai/answer — that run concurrently and settle independently. These
 * tests pin the contract each side submits, and that one side's failure is a
 * rendered value rather than an exception that could take the other down.
 */

vi.mock("@/lib/api", () => ({
  api: {
    searchEvidence: vi.fn(),
    answerQuestion: vi.fn(),
  },
}));

const { api } = await import("@/lib/api");
const searchEvidence = vi.mocked(api.searchEvidence);
const answerQuestion = vi.mocked(api.answerQuestion);

const evidenceResult: EvidenceSearchResult = {
  query: "deploy",
  candidates: [
    {
      candidateId: "cand-1",
      candidateName: "Rakhmatillo Andrew",
      passages: [
        {
          documentId: "doc-1",
          documentName: "Andrew-Resume-Eng.pdf",
          page: 1,
          section: "experience",
          text: "Helped maintain CI/CD pipelines using Docker and GitHub Actions",
          sourceType: "FILE",
          sourceUrl: null,
        },
      ],
    },
  ],
  reranked: true,
  totalConsidered: 22,
  durationMs: 1800,
};

function groundedAnswer(status: GroundedAnswer["status"]): GroundedAnswer {
  return {
    answer:
      "Rakhmatillo Andrew deploy bo'yicha tajribaga ega [6e13b9eb-cd72-55e4-b000-000000000001].",
    status,
    citations: [
      {
        id: "6e13b9eb-cd72-55e4-b000-000000000001",
        chunkId: "6e13b9eb-cd72-55e4-b000-000000000001",
        documentId: "doc-1",
        documentName: "Andrew-Resume-Eng.pdf",
        page: 1,
        section: "experience",
        snippet: "Helped maintain CI/CD pipelines using Docker",
        sourceType: "FILE",
        sourceUrl: null,
      },
    ],
    locale: "uz",
    evidenceConsidered: 8,
    durationMs: 23157,
    model: "gemini-3.6-flash",
    rejectedCitationCount: 0,
  };
}

function unavailable(): ApiError {
  return new ApiError("The AI service is not configured", 503, "unavailable");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runEvidenceSearch", () => {
  it("submits the trimmed query to the evidence endpoint", async () => {
    searchEvidence.mockResolvedValue(evidenceResult);

    const result = await runEvidenceSearch("  deploy tajriba  ");

    expect(searchEvidence).toHaveBeenCalledExactlyOnceWith({
      query: "deploy tajriba",
    });
    expect(result).toEqual({ ok: true, result: evidenceResult });
  });

  it("reports a 503 as unavailable, distinct from finding nothing", async () => {
    searchEvidence.mockRejectedValue(unavailable());

    expect(await runEvidenceSearch("deploy")).toEqual({
      ok: false,
      message: "The AI service is not configured",
      unavailable: true,
    });
  });

  it("settles a network failure instead of throwing", async () => {
    searchEvidence.mockRejectedValue(networkError());

    const result = await runEvidenceSearch("deploy");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.unavailable).toBe(false);
  });
});

describe("runGroundedAnswer", () => {
  it("submits the same query org-wide — no candidateId", async () => {
    answerQuestion.mockResolvedValue(groundedAnswer("GROUNDED"));

    const result = await runGroundedAnswer("  deploy tajriba  ", "uz");

    expect(answerQuestion).toHaveBeenCalledExactlyOnceWith({
      query: "deploy tajriba",
      locale: "uz",
    });
    expect(
      answerQuestion.mock.calls[0][0],
    ).not.toHaveProperty("candidateId");
    expect(result).toEqual({ ok: true, data: groundedAnswer("GROUNDED") });
  });

  it("sends the Korean UI locale unchanged", async () => {
    answerQuestion.mockResolvedValue(groundedAnswer("GROUNDED"));

    await runGroundedAnswer("백엔드 경험", "ko");

    expect(answerQuestion).toHaveBeenCalledExactlyOnceWith({
      query: "백엔드 경험",
      locale: "ko",
    });
  });

  it("returns the answer statuses untouched — never upgraded to confidence", async () => {
    for (const status of [
      "GROUNDED",
      "INSUFFICIENT_EVIDENCE",
      "NEEDS_HUMAN_REVIEW",
    ] as const) {
      answerQuestion.mockResolvedValue(groundedAnswer(status));
      const result = await runGroundedAnswer("deploy", "en");
      expect(result.ok && result.data.status).toBe(status);
    }
  });

  it("keeps the Uzbek answer and its citations exactly as returned", async () => {
    answerQuestion.mockResolvedValue(groundedAnswer("GROUNDED"));

    const result = await runGroundedAnswer(
      "menga deploy bo'yicha hodim kerak va summary qil",
      "uz",
    );

    expect(result.ok && result.data.locale).toBe("uz");
    expect(result.ok && result.data.citations).toHaveLength(1);
    expect(result.ok && result.data.answer).toContain("deploy bo'yicha");
  });

  it("maps a 503 to generation_unavailable so the UI can say retrieval still works", async () => {
    answerQuestion.mockRejectedValue(unavailable());

    expect(await runGroundedAnswer("deploy", "en")).toEqual({
      ok: false,
      reason: "generation_unavailable",
      message: "The AI service is not configured",
    });
  });

  it("declines a query below the backend's 3-character minimum without a network call", async () => {
    const result = await runGroundedAnswer("ok", "en");

    expect(answerQuestion).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      message: "Query too short.",
    });
  });
});

describe("the two halves settle independently", () => {
  it("a generation failure cannot hide successful retrieval", async () => {
    searchEvidence.mockResolvedValue(evidenceResult);
    answerQuestion.mockRejectedValue(unavailable());

    const [evidence, answer] = await Promise.all([
      runEvidenceSearch("deploy"),
      runGroundedAnswer("deploy", "uz"),
    ]);

    expect(evidence.ok).toBe(true);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.reason).toBe("generation_unavailable");
  });

  it("a retrieval failure cannot hide a valid grounded answer", async () => {
    searchEvidence.mockRejectedValue(unavailable());
    answerQuestion.mockResolvedValue(groundedAnswer("GROUNDED"));

    const [evidence, answer] = await Promise.all([
      runEvidenceSearch("deploy"),
      runGroundedAnswer("deploy", "uz"),
    ]);

    expect(evidence.ok).toBe(false);
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.data.citations).toHaveLength(1);
  });

  it("each side runs exactly one request — no duplicates", async () => {
    searchEvidence.mockResolvedValue(evidenceResult);
    answerQuestion.mockResolvedValue(groundedAnswer("GROUNDED"));

    await Promise.all([
      runEvidenceSearch("deploy"),
      runGroundedAnswer("deploy", "uz"),
    ]);

    expect(searchEvidence).toHaveBeenCalledTimes(1);
    expect(answerQuestion).toHaveBeenCalledTimes(1);
  });
});
