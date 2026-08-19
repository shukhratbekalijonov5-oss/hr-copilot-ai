import { describe, expect, it } from "vitest";
import { aiFailureReason, runAiAction } from "@/lib/api/ai-failure";
import { ApiError, apiErrorFromResponse, networkError } from "@/lib/api/errors";

function serviceUnavailable(message: string): Promise<ApiError> {
  return apiErrorFromResponse(
    new Response(JSON.stringify({ message, statusCode: 503 }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("aiFailureReason", () => {
  it("reads a 503 on a generation call as generation being unavailable", async () => {
    const error = await serviceUnavailable(
      "Cannot summarise candidates: the AI service is not configured",
    );
    expect(error.kind).toBe("unavailable");
    expect(aiFailureReason(error, "generation")).toBe("generation_unavailable");
  });

  it("reads the same 503 on a retrieval call as retrieval being unavailable", async () => {
    const error = await serviceUnavailable(
      "Evidence search is unavailable: the AI service is not configured",
    );
    // The status code alone cannot tell these apart, which is why the caller
    // says which capability it needed.
    expect(aiFailureReason(error, "retrieval")).toBe("retrieval_unavailable");
  });

  it("keeps a network failure distinct from a service outage", () => {
    expect(aiFailureReason(networkError(), "generation")).toBe("network");
    expect(aiFailureReason(networkError(), "retrieval")).toBe("network");
  });

  it("reports a role restriction as forbidden, not as a failure", () => {
    const error = new ApiError("Insufficient role", 403, "forbidden");
    expect(aiFailureReason(error, "retrieval")).toBe("forbidden");
  });

  it("maps not-found and validation to their own reasons", () => {
    expect(
      aiFailureReason(new ApiError("nope", 404, "not_found"), "generation"),
    ).toBe("not_found");
    expect(
      aiFailureReason(new ApiError("bad", 400, "validation"), "generation"),
    ).toBe("invalid");
  });

  it("falls back to a generic reason for anything else", () => {
    expect(aiFailureReason(new Error("boom"), "generation")).toBe("error");
    expect(
      aiFailureReason(new ApiError("oops", 500, "server"), "generation"),
    ).toBe("error");
  });

  it("never collapses distinct failures into one reason", () => {
    const reasons = new Set([
      aiFailureReason(networkError(), "generation"),
      aiFailureReason(new ApiError("x", 503, "unavailable"), "generation"),
      aiFailureReason(new ApiError("x", 503, "unavailable"), "retrieval"),
      aiFailureReason(new ApiError("x", 403, "forbidden"), "generation"),
    ]);
    expect(reasons.size).toBe(4);
  });
});

describe("runAiAction", () => {
  it("returns the value on success", async () => {
    const result = await runAiAction("generation", async () => 42);
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it("classifies a generation outage without exposing provider internals", async () => {
    const error = await serviceUnavailable(
      "Cannot answer questions: the AI service is not configured",
    );
    const result = await runAiAction("generation", async () => {
      throw error;
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("generation_unavailable");
    expect(result.message).not.toMatch(/gemini|api[_ ]?key|qdrant/i);
  });

  it("keeps evidence retrieval classified separately from generation", async () => {
    const error = await serviceUnavailable("Evidence search is unavailable");
    const generation = await runAiAction("generation", async () => {
      throw error;
    });
    const retrieval = await runAiAction("retrieval", async () => {
      throw error;
    });

    expect(generation.ok).toBe(false);
    expect(retrieval.ok).toBe(false);
    if (generation.ok || retrieval.ok) return;
    expect(generation.reason).not.toBe(retrieval.reason);
  });
});
