import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromResponse } from "@/lib/api/errors";
import { isPlanUpgradeError, planUpgradeFrom } from "@/lib/entitlements/plan-error";

/**
 * A plan refusal must reach the reader as a paywall, never as an error.
 *
 * The failure this guards against is quiet and bad: a 403 falls into the
 * generic forbidden branch, the reader is told "Your role does not allow this
 * action", and a product they could buy in two clicks looks broken instead.
 */

function forbidden(body: Record<string, unknown>): Promise<ApiError> {
  return apiErrorFromResponse(
    new Response(JSON.stringify({ statusCode: 403, error: "Forbidden", ...body }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("recognising a plan refusal", () => {
  it("reads the code out of `message`, as this API sends it", async () => {
    const error = await forbidden({
      message: "PLAN_UPGRADE_REQUIRED",
      requiredPlan: "MAX",
      capability: "EXTERNAL_AI_SEARCH",
    });

    expect(isPlanUpgradeError(error)).toBe(true);
    expect(planUpgradeFrom(error, "EXTERNAL_AI_SEARCH")).toEqual({
      requiredPlan: "MAX",
      capability: "EXTERNAL_AI_SEARCH",
    });
  });

  it("reads it out of `code` too, so either convention works", async () => {
    const error = await forbidden({
      message: "You need a higher plan.",
      code: "PLAN_UPGRADE_REQUIRED",
      requiredPlan: "PRO",
    });

    expect(planUpgradeFrom(error, "INTERNAL_AI_SEARCH")?.requiredPlan).toBe("PRO");
  });

  it("falls back to the surface's own requirement when the body names none", async () => {
    // The caller always knows what it was trying to open, even when the error
    // does not — so the paywall can still say WHICH plan instead of vaguely
    // suggesting an upgrade.
    const error = await forbidden({ message: "PLAN_UPGRADE_REQUIRED" });

    expect(planUpgradeFrom(error, "EXTERNAL_AI_SEARCH")).toEqual({
      requiredPlan: "MAX",
      capability: "EXTERNAL_AI_SEARCH",
    });
    expect(planUpgradeFrom(error, "INTERNAL_AI_SEARCH")?.requiredPlan).toBe("PRO");
  });

  it("ignores a plan name it cannot read and uses its own", async () => {
    const error = await forbidden({
      message: "PLAN_UPGRADE_REQUIRED",
      requiredPlan: "PLATINUM",
      capability: "EXTERNAL_AI_SEARCH",
    });

    expect(planUpgradeFrom(error, "EXTERNAL_AI_SEARCH")?.requiredPlan).toBe("MAX");
  });
});

describe("what is NOT a paywall", () => {
  it("leaves a plain 403 alone", async () => {
    // A revoked session or a missing candidate account is a different problem,
    // and selling somebody Max would not fix it.
    const error = await forbidden({ message: "Forbidden resource" });

    expect(isPlanUpgradeError(error)).toBe(false);
    expect(planUpgradeFrom(error, "EXTERNAL_AI_SEARCH")).toBeNull();
  });

  it("ignores the same code on a non-403", async () => {
    const error = await apiErrorFromResponse(
      new Response(JSON.stringify({ statusCode: 500, message: "PLAN_UPGRADE_REQUIRED" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(isPlanUpgradeError(error)).toBe(false);
  });

  it("ignores anything that is not an ApiError", () => {
    expect(planUpgradeFrom(new Error("boom"), "EXTERNAL_AI_SEARCH")).toBeNull();
    expect(planUpgradeFrom(null, "EXTERNAL_AI_SEARCH")).toBeNull();
    expect(planUpgradeFrom("PLAN_UPGRADE_REQUIRED", "EXTERNAL_AI_SEARCH")).toBeNull();
  });
});

describe("error details stay a narrow channel", () => {
  it("carries short string siblings of the message", async () => {
    const error = await forbidden({
      message: "PLAN_UPGRADE_REQUIRED",
      requiredPlan: "MAX",
    });
    expect(error.details.requiredPlan).toBe("MAX");
    expect(error.details.message).toBeUndefined();
    expect(error.details.statusCode).toBeUndefined();
  });

  it("never carries anything off a 500", async () => {
    // The one response that can contain internals keeps its whole body out of
    // the client, details included.
    const error = await apiErrorFromResponse(
      new Response(JSON.stringify({ statusCode: 500, message: "boom", query: "SELECT ..." }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(error.details).toEqual({});
  });

  it("drops non-strings and over-long values", async () => {
    const error = await forbidden({
      message: "PLAN_UPGRADE_REQUIRED",
      retries: 3,
      nested: { a: 1 },
      essay: "x".repeat(201),
      requiredPlan: "MAX",
    });
    expect(Object.keys(error.details)).toEqual(["requiredPlan"]);
  });
});
