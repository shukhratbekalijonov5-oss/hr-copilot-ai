import { describe, expect, it } from "vitest";
import {
  CANDIDATE_PLANS,
  PLAN_PRICES,
  allows,
  isCandidatePlan,
  isPlanCapability,
  planIncludes,
  priceFor,
  requiredPlanFor,
  resolveEntitlements,
  withCapabilityDenied,
} from "@/lib/entitlements/plan";

/**
 * The plan matrix, stated once as a test so a repricing has to come here.
 *
 * Each row is the whole product decision for one plan: FREE keeps ordinary job
 * search and nothing AI; PRO adds the internal AI search; MAX adds the external
 * one on top. Normal Find Jobs is not represented at all — it is not a
 * capability, because it is not gated, and inventing an entitlement for it
 * would create a switch somebody could later flip.
 */
describe("what each plan unlocks", () => {
  it("FREE has neither AI job search", () => {
    const free = resolveEntitlements({ plan: "FREE" });
    expect(free.plan).toBe("FREE");
    expect(free.stated).toBe(true);
    expect(free.canUseInternalAiJobs).toBe(false);
    expect(free.canUseExternalAiJobs).toBe(false);
  });

  it("PRO has the internal AI search and not the external one", () => {
    const pro = resolveEntitlements({ plan: "PRO" });
    expect(pro.canUseInternalAiJobs).toBe(true);
    expect(pro.canUseExternalAiJobs).toBe(false);
  });

  it("MAX has both", () => {
    const max = resolveEntitlements({ plan: "MAX" });
    expect(max.canUseInternalAiJobs).toBe(true);
    expect(max.canUseExternalAiJobs).toBe(true);
  });

  it("keeps the tiers strictly cumulative", () => {
    // A higher plan may never lose something a lower one had. Anything else is
    // a downgrade wearing an upgrade's name.
    const [free, pro, max] = CANDIDATE_PLANS.map((plan) =>
      resolveEntitlements({ plan }),
    );
    for (const key of ["canUseInternalAiJobs", "canUseExternalAiJobs"] as const) {
      expect(Number(free[key])).toBeLessThanOrEqual(Number(pro[key]));
      expect(Number(pro[key])).toBeLessThanOrEqual(Number(max[key]));
    }
  });

  it("names the plan each capability needs", () => {
    expect(requiredPlanFor("INTERNAL_AI_SEARCH")).toBe("PRO");
    expect(requiredPlanFor("EXTERNAL_AI_SEARCH")).toBe("MAX");
    expect(planIncludes("MAX", "EXTERNAL_AI_SEARCH")).toBe(true);
    expect(planIncludes("PRO", "EXTERNAL_AI_SEARCH")).toBe(false);
  });
});

/**
 * The rule that keeps a parallel rollout from locking real people out.
 *
 * A backend that predates plans says nothing about them. Reading that silence
 * as FREE would be the frontend inventing a restriction — and would black out
 * a working feature for every existing candidate the moment this ships ahead
 * of the API. It costs nothing to allow through, because the API refuses
 * independently and the 403 lands on the same paywall.
 */
describe("a backend that states nothing", () => {
  it("does not guess a plan, and does not lock", () => {
    for (const source of [null, undefined, {}, { plan: null }, { capabilities: null }]) {
      const resolved = resolveEntitlements(source);
      expect(resolved.plan).toBeNull();
      expect(resolved.stated).toBe(false);
      expect(resolved.canUseInternalAiJobs).toBe(true);
      expect(resolved.canUseExternalAiJobs).toBe(true);
    }
  });

  it("treats a plan name this build does not know as unstated", () => {
    // Locking on a value we cannot read would still be a guess, and guessing
    // downward is not the safe direction — it is just a confident mistake.
    const resolved = resolveEntitlements({ plan: "ENTERPRISE" });
    expect(resolved.plan).toBeNull();
    expect(resolved.stated).toBe(false);
    expect(resolved.canUseExternalAiJobs).toBe(true);
  });

  it("never reads a plan out of anything but the argument", () => {
    // No localStorage, no URL, no remembered value — the function is pure and
    // takes exactly one input.
    expect(resolveEntitlements.length).toBe(1);
  });
});

describe("an explicit capability list outranks the plan name", () => {
  it("grants what the backend granted, even against the tier table", () => {
    const resolved = resolveEntitlements({
      plan: "FREE",
      capabilities: ["EXTERNAL_AI_SEARCH"],
    });
    // A hand-granted capability, a legacy account or a promotion is something
    // only the backend knows; re-deriving from "FREE" would overrule it.
    expect(resolved.canUseExternalAiJobs).toBe(true);
    expect(resolved.canUseInternalAiJobs).toBe(false);
    // The plan is still reported, because it is what the reader is shown.
    expect(resolved.plan).toBe("FREE");
  });

  it("reads an empty list as 'none', not as 'unknown'", () => {
    const resolved = resolveEntitlements({ plan: "MAX", capabilities: [] });
    expect(resolved.stated).toBe(true);
    expect(resolved.canUseInternalAiJobs).toBe(false);
    expect(resolved.canUseExternalAiJobs).toBe(false);
  });

  it("drops capability names it does not recognise", () => {
    const resolved = resolveEntitlements({
      capabilities: ["EXTERNAL_AI_SEARCH", "TIME_TRAVEL"],
    });
    expect(resolved.canUseExternalAiJobs).toBe(true);
    expect(resolved.canUseInternalAiJobs).toBe(false);
  });
});

describe("a refusal learned mid-render", () => {
  it("denies the refused capability and leaves the other alone", () => {
    // The external search was called because the session said nothing, and the
    // backend refused it. Within this render that refusal is authoritative, so
    // the tab strip beside the paywall shows the lock instead of contradicting
    // the page it sits on.
    const denied = withCapabilityDenied(resolveEntitlements(null), "EXTERNAL_AI_SEARCH");
    expect(denied.canUseExternalAiJobs).toBe(false);
    expect(denied.canUseInternalAiJobs).toBe(true);
    expect(denied.stated).toBe(true);
  });

  it("does not infer which plan the reader holds", () => {
    // A refusal names the plan REQUIRED, never the one held. Writing FREE here
    // would put a wrong "You are on Free" in front of a paying Pro customer.
    const denied = withCapabilityDenied(
      resolveEntitlements({ plan: "PRO" }),
      "EXTERNAL_AI_SEARCH",
    );
    expect(denied.plan).toBeNull();
  });

  it("returns a new object rather than mutating the session's", () => {
    const base = resolveEntitlements({ plan: "MAX" });
    const denied = withCapabilityDenied(base, "EXTERNAL_AI_SEARCH");
    expect(base.canUseExternalAiJobs).toBe(true);
    expect(denied).not.toBe(base);
  });
});

describe("guards and lookups", () => {
  it("narrows plan and capability strings", () => {
    expect(isCandidatePlan("MAX")).toBe(true);
    expect(isCandidatePlan("max")).toBe(false);
    expect(isCandidatePlan(2)).toBe(false);
    expect(isPlanCapability("EXTERNAL_AI_SEARCH")).toBe(true);
    expect(isPlanCapability("EXTERNAL")).toBe(false);
  });

  it("reads a named capability off a resolved set", () => {
    const pro = resolveEntitlements({ plan: "PRO" });
    expect(allows(pro, "INTERNAL_AI_SEARCH")).toBe(true);
    expect(allows(pro, "EXTERNAL_AI_SEARCH")).toBe(false);
  });

  it("prices the three plans, with zero as a real price", () => {
    expect(PLAN_PRICES.map((entry) => entry.monthlyUsd)).toEqual([0, 7, 12]);
    expect(priceFor("PRO").monthlyUsd).toBe(7);
    expect(priceFor("MAX").monthlyUsd).toBe(12);
    // Ordered by price, so the cards read cheapest-first without a sort.
    expect(PLAN_PRICES.map((entry) => entry.plan)).toEqual([...CANDIDATE_PLANS]);
  });
});
