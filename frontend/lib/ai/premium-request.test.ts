import { describe, expect, it } from "vitest";
import {
  aiRequestFor,
  canStartAiRequest,
  failedAiRequest,
  idleAiRequest,
  isRetryable,
  readyAiRequest,
  startedAiRequest,
} from "@/lib/ai/premium-request";

/**
 * The two rules that cost real money or real trust when they are wrong.
 *
 * These are unit tests of pure functions rather than of a rendered component
 * on purpose: "a second click must not buy a second Gemini call" is a decision
 * about state, and testing it through a renderer is how duplicate-request bugs
 * survive a test suite that looks green.
 */

const JOB = "job-a";
const OTHER = "job-b";

describe("a second press must not start a second generation", () => {
  it("refuses while one is in flight for the same job", () => {
    const inFlight = startedAiRequest<string>(JOB);
    expect(canStartAiRequest(inFlight, JOB)).toBe(false);
  });

  it("refuses when this job is already explained", () => {
    // The text is on screen. Regenerating spends the budget again to produce
    // the same paragraphs.
    const done = readyAiRequest(JOB, "explained");
    expect(canStartAiRequest(done, JOB)).toBe(false);
  });

  it("refuses when the plan does not include it", () => {
    // No amount of pressing changes a plan, so this never becomes a request.
    const locked = failedAiRequest<string>(JOB, "plan_required", "MAX");
    expect(canStartAiRequest(locked, JOB)).toBe(false);
  });

  it("allows a retry after every recoverable failure", () => {
    for (const status of ["unavailable", "error", "gone"] as const) {
      expect(canStartAiRequest(failedAiRequest<string>(JOB, status), JOB)).toBe(true);
    }
  });

  it("allows a first request, and one per job", () => {
    expect(canStartAiRequest(idleAiRequest<string>(), JOB)).toBe(true);
    // A generation running for another job must not block this one: the
    // reader opened a different drawer, which is a different question.
    expect(canStartAiRequest(startedAiRequest<string>(OTHER), JOB)).toBe(true);
  });
});

describe("state belongs to a subject, never floats free", () => {
  it("reads another job's result as 'nothing asked for yet'", () => {
    // Without this, an explanation generated for job A renders under job B's
    // title the moment the reader switches — silently, and plausibly.
    const forA = readyAiRequest(JOB, "A's explanation");
    expect(aiRequestFor(forA, OTHER).status).toBe("idle");
    expect(aiRequestFor(forA, OTHER).value).toBeNull();
  });

  it("returns the value again for the job it belongs to", () => {
    const forA = readyAiRequest(JOB, "A's explanation");
    expect(aiRequestFor(forA, JOB).value).toBe("A's explanation");
  });

  it("does not attach a plan to a non-plan failure", () => {
    // Otherwise "Upgrade to Max" could render over a model timeout.
    expect(failedAiRequest<string>(JOB, "unavailable", "MAX").requiredPlan).toBeNull();
    expect(failedAiRequest<string>(JOB, "plan_required", "MAX").requiredPlan).toBe("MAX");
  });
});

describe("only recoverable states offer a retry", () => {
  it("never offers one for a plan refusal or a vanished job", () => {
    expect(isRetryable("plan_required")).toBe(false);
    expect(isRetryable("gone")).toBe(false);
  });

  it("offers one where trying again can actually work", () => {
    expect(isRetryable("unavailable")).toBe(true);
    expect(isRetryable("error")).toBe(true);
  });

  it("offers none while idle, loading or done", () => {
    for (const status of ["idle", "loading", "ready"] as const) {
      expect(isRetryable(status)).toBe(false);
    }
  });
});
