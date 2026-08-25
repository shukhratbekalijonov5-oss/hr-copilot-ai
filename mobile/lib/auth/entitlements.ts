import type { PlanCapability, SessionUser } from "@/types";

/**
 * What this account may use — read from the server's answer, never guessed.
 *
 * ## Unstated is OPEN, not FREE
 *
 * An API that reports no plan is telling us nothing, not telling us "free".
 * Treating silence as the lowest tier would black out working features for
 * every account the moment a deploy stopped sending the field. The backend's
 * 403 remains the real boundary — this only decides whether to draw a lock.
 */
export function allows(
  user: SessionUser | null,
  capability: PlanCapability,
): boolean {
  if (!user) return false;
  const capabilities = user.capabilities;
  // Null/undefined = the server said nothing about plans at all.
  if (capabilities === null || capabilities === undefined) return true;
  return capabilities.includes(capability);
}

/** The plan a capability needs, for the lock badge. Presentation only. */
export function requiredPlanFor(capability: PlanCapability): "PRO" | "MAX" {
  return capability === "EXTERNAL_AI_SEARCH" ? "MAX" : "PRO";
}
