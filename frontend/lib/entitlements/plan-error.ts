import { ApiError } from "@/lib/api/errors";
import {
  isCandidatePlan,
  isPlanCapability,
  requiredPlanFor,
  type CandidatePlan,
  type PlanCapability,
} from "@/lib/entitlements/plan";

/**
 * "You need a higher plan", as a value the UI can render.
 *
 * ## Why a 403 must not become "Something went wrong"
 *
 * The generic forbidden copy — *Your role does not allow this action* — is
 * both wrong and useless here. Nothing is broken, the reader's role is fine,
 * and there is a concrete thing they can do about it. Turning that refusal
 * into a shrug hides a product from the person it was built for and makes the
 * app look faulty at the same time.
 *
 * ## The backend wins, always
 *
 * This is the second of the two gates and the only authoritative one. The
 * entitlements resolved from the session decide what to render BEFORE a call;
 * this decides what to render when a call was made anyway and refused. Both
 * paths reach the same paywall, which is what makes a plan that changed in
 * another tab, or a build that predates plans entirely, behave correctly
 * without the frontend ever being the thing that says no.
 */
export interface PlanUpgradeRequirement {
  /** The plan that would unlock it. Never null — see `fallbackCapability`. */
  requiredPlan: CandidatePlan;
  /** Which surface was refused, when the backend named one. */
  capability: PlanCapability | null;
}

/** The agreed code. Accepted from `code` or from `message`, see below. */
const PLAN_UPGRADE_REQUIRED = "PLAN_UPGRADE_REQUIRED";

function carriesPlanCode(error: ApiError): boolean {
  // This API puts its machine-readable code in `message` (as the tracking 409
  // does) while NestJS convention would put it in `code`. Reading both means a
  // backend that picks either one produces a paywall rather than a shrug, and
  // costs nothing: no other refusal in the product uses this string.
  return error.code === PLAN_UPGRADE_REQUIRED || error.message === PLAN_UPGRADE_REQUIRED;
}

/**
 * Reads a plan refusal off a thrown value, or returns null if it is not one.
 *
 * `fallbackCapability` is the surface the caller was rendering. It is used
 * only when the backend named no capability, so the paywall can still say
 * WHICH plan is needed instead of vaguely suggesting an upgrade — the caller
 * always knows what it was trying to open, even when the error does not.
 */
export function planUpgradeFrom(
  error: unknown,
  fallbackCapability: PlanCapability,
): PlanUpgradeRequirement | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status !== 403 || !carriesPlanCode(error)) return null;

  const capability = isPlanCapability(error.details.capability)
    ? error.details.capability
    : null;

  // The backend's own required plan is preferred; an unreadable one falls back
  // to what this build knows the surface costs, which is a statement about our
  // own product rather than a guess about theirs.
  const requiredPlan = isCandidatePlan(error.details.requiredPlan)
    ? (error.details.requiredPlan as CandidatePlan)
    : requiredPlanFor(capability ?? fallbackCapability);

  return { requiredPlan, capability: capability ?? fallbackCapability };
}

/**
 * True for any refusal that should be shown as a paywall rather than an error.
 *
 * A plain 403 without the code is NOT one of these: it means something else is
 * wrong (a candidate account that does not exist, a revoked session) and
 * dressing it as "upgrade to Max" would sell a plan that would not fix it.
 */
export function isPlanUpgradeError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && carriesPlanCode(error);
}
