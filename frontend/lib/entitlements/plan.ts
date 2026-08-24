/**
 * Candidate plans, and what each one unlocks.
 *
 * ## One definition, consumed everywhere
 *
 * `plan === "MAX"` appears in exactly one place in this product: the table
 * below. Every screen asks a named question — `canUseExternalAiJobs` — and gets
 * a boolean. That is what makes a future plan (a trial, an annual tier, a
 * grandfathered account) a change to this file rather than a hunt through
 * dozens of components, and it is why no component imports `CandidatePlan` in
 * order to compare it to a literal.
 *
 * ## The backend is the authority, and silence is not a verdict
 *
 * `resolveEntitlements` reads what the API said about the caller. When the API
 * says nothing — an older deployment, a response shape that predates plans —
 * the answer is `plan: null, stated: false`, and every capability is allowed
 * through. That is deliberate, and it is the opposite of the cautious-looking
 * alternative:
 *
 *   - Guessing FREE would be the frontend inventing a restriction the backend
 *     never stated, and would lock every existing candidate out of a feature
 *     that works, the moment this code ships ahead of the API.
 *   - Allowing through costs nothing, because the API independently refuses
 *     what the caller may not have. A locked screen that renders is a UX bug;
 *     a fetch that succeeds when it should not is impossible from here.
 *
 * So this module decides what to SHOW. It never decides what is permitted —
 * a 403 does, and `planUpgradeFrom` turns that answer into the same paywall.
 */

export const CANDIDATE_PLANS = ["FREE", "PRO", "MAX"] as const;
export type CandidatePlan = (typeof CANDIDATE_PLANS)[number];
export type Plan = CandidatePlan;

/**
 * The gated surfaces, named after what a person does rather than after the
 * plan that happens to include them today. Repricing must not rename a
 * capability.
 */
export const PLAN_CAPABILITIES = [
  "INTERNAL_AI_SEARCH",
  "EXTERNAL_AI_SEARCH",
] as const;
// These names are the BACKEND's, verbatim from its plan policy — they arrive
// in a 403 body and must match on the way in. A friendlier local synonym would
// mean translating a vocabulary in two directions for no gain, and would fail
// silently the first time one side added a capability.
export type PlanCapability = (typeof PLAN_CAPABILITIES)[number];

/** Plans are ordered: a higher tier includes everything below it. */
const PLAN_RANK: Record<CandidatePlan, number> = { FREE: 0, PRO: 1, MAX: 2 };

/** The single source of truth for who gets what. */
const REQUIRED_PLAN: Record<PlanCapability, CandidatePlan> = {
  INTERNAL_AI_SEARCH: "PRO",
  EXTERNAL_AI_SEARCH: "MAX",
};

export function isCandidatePlan(value: unknown): value is CandidatePlan {
  return (
    typeof value === "string" &&
    (CANDIDATE_PLANS as readonly string[]).includes(value)
  );
}

export function isPlanCapability(value: unknown): value is PlanCapability {
  return (
    typeof value === "string" &&
    (PLAN_CAPABILITIES as readonly string[]).includes(value)
  );
}

export function requiredPlanFor(capability: PlanCapability): CandidatePlan {
  return REQUIRED_PLAN[capability];
}

export function planIncludes(
  plan: CandidatePlan,
  capability: PlanCapability,
): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[REQUIRED_PLAN[capability]];
}

/** Everything a screen needs to decide what to render, and nothing more. */
export interface Entitlements {
  /**
   * The caller's plan, or null when the backend named none. Null is a real
   * state — "not stated" — and is never rendered as "Free".
   */
  plan: CandidatePlan | null;
  /**
   * True when the backend actually told us. False means this build is talking
   * to an API that does not know about plans yet, and the locks below are
   * open rather than guessed shut.
   */
  stated: boolean;
  canUseInternalAiJobs: boolean;
  canUseExternalAiJobs: boolean;
}

/** What the API may tell us about the caller's plan. Every field optional. */
export interface EntitlementSource {
  plan?: string | null;
  /**
   * The backend's own capability list, when it sends one. It OUTRANKS the
   * plan: a hand-granted capability, a legacy account or a promotion is
   * something only the backend knows, and re-deriving from the plan name here
   * would quietly overrule it.
  */
  capabilities?: readonly string[] | null;
}

const OPEN: Entitlements = {
  plan: null,
  stated: false,
  canUseInternalAiJobs: true,
  canUseExternalAiJobs: true,
};

export function resolveEntitlements(
  source: EntitlementSource | null | undefined,
): Entitlements {
  const capabilities = Array.isArray(source?.capabilities)
    ? source.capabilities.filter(isPlanCapability)
    : null;
  const plan = isCandidatePlan(source?.plan) ? source.plan : null;

  // A capability list is a statement even when it is empty: "you have none"
  // is an answer, and `[]` must lock rather than fall through to open.
  if (capabilities) {
    return {
      plan,
      stated: true,
      canUseInternalAiJobs: capabilities.includes("INTERNAL_AI_SEARCH"),
      canUseExternalAiJobs: capabilities.includes("EXTERNAL_AI_SEARCH"),
    };
  }

  // An unrecognised plan name — a tier this build predates — is treated as
  // unstated rather than as the lowest one. Locking on a value we cannot read
  // would be a guess, and guessing downward is still guessing.
  if (!plan) return OPEN;

  return {
    plan,
    stated: true,
    canUseInternalAiJobs: planIncludes(plan, "INTERNAL_AI_SEARCH"),
    canUseExternalAiJobs: planIncludes(plan, "EXTERNAL_AI_SEARCH"),
  };
}

/** Reads one capability off a resolved set, for code that is parameterised. */
export function allows(
  entitlements: Entitlements,
  capability: PlanCapability,
): boolean {
  return capability === "INTERNAL_AI_SEARCH"
    ? entitlements.canUseInternalAiJobs
    : entitlements.canUseExternalAiJobs;
}

/**
 * The same entitlements with one capability known to be denied.
 *
 * Used when a render learned the truth the hard way: the session carried no
 * plan, the call was made, and the backend refused it. Within that render the
 * refusal is authoritative, so the tab strip beside the paywall shows the lock
 * instead of contradicting the page it sits on.
 *
 * It does NOT learn the reader's plan — a refusal says which plan is required,
 * never which one they hold — so `plan` is cleared rather than guessed
 * downward, and nothing is remembered past this render.
 */
export function withCapabilityDenied(
  entitlements: Entitlements,
  capability: PlanCapability,
): Entitlements {
  return {
    ...entitlements,
    plan: null,
    stated: true,
    canUseInternalAiJobs:
      capability === "INTERNAL_AI_SEARCH" ? false : entitlements.canUseInternalAiJobs,
    canUseExternalAiJobs:
      capability === "EXTERNAL_AI_SEARCH" ? false : entitlements.canUseExternalAiJobs,
  };
}

export type PlanActionKind = "current" | "upgrade" | "downgrade" | "choose";
export type CheckoutPlan = Extract<CandidatePlan, "PRO" | "MAX">;

/** The paid plans a checkout can be started for, in display order. */
export const CHECKOUT_PLANS = ["PRO", "MAX"] as const satisfies readonly CheckoutPlan[];

export function planActionFor(
  current: CandidatePlan | null,
  target: CandidatePlan,
): PlanActionKind {
  if (!current) return "choose";
  if (current === target) return "current";
  return PLAN_RANK[target] > PLAN_RANK[current] ? "upgrade" : "downgrade";
}

export function isCheckoutPlan(plan: CandidatePlan): plan is CheckoutPlan {
  return plan === "PRO" || plan === "MAX";
}

export function canStartCheckout(
  current: CandidatePlan | null,
  target: CandidatePlan,
): target is CheckoutPlan {
  const action = planActionFor(current, target);
  return isCheckoutPlan(target) && (action === "upgrade" || action === "choose");
}

export function capabilitiesForPlan(plan: CandidatePlan): PlanCapability[] {
  return PLAN_CAPABILITIES.filter((capability) => planIncludes(plan, capability));
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Display prices only.
 *
 * Nothing here is charged, compared against a receipt, or sent anywhere: there
 * is no payment service yet, and a number on a marketing card is not a price a
 * customer has agreed to. When billing exists these come from it.
 */
export interface PlanPrice {
  plan: CandidatePlan;
  /** US dollars per month. Zero is a real price, not a missing one. */
  monthlyUsd: number;
}

export const PLAN_PRICES: readonly PlanPrice[] = [
  { plan: "FREE", monthlyUsd: 0 },
  { plan: "PRO", monthlyUsd: 7 },
  { plan: "MAX", monthlyUsd: 12 },
];

export function priceFor(plan: CandidatePlan): PlanPrice {
  return PLAN_PRICES.find((entry) => entry.plan === plan) ?? PLAN_PRICES[0];
}

/**
 * Fixed KRW amounts charged by the Toss card checkout, DISPLAY ONLY —
 * pre-formatted strings, mirroring the server-authoritative amounts in the
 * payment service (Plan.monthlyPriceKrw). Fixed pricing, never live FX; the
 * browser never sends an amount or currency anywhere.
 */
export const KRW_CHECKOUT_CHARGE: Record<CheckoutPlan, string> = {
  PRO: "9,900",
  MAX: "16,900",
};
