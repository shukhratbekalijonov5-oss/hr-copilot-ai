import { SetMetadata } from '@nestjs/common';
import type { CandidateCapability } from './candidate-plan.policy';

export const REQUIRES_CAPABILITY_KEY = 'requiresCapability';

/**
 * Marks a route (or a whole controller) as requiring a candidate plan
 * capability. PlanCapabilityGuard reads this and answers 403
 * PLAN_UPGRADE_REQUIRED for a plan that lacks it.
 *
 * The decorator names the CAPABILITY, never the plan: routes say what they
 * are ("this is external AI search"), and which tier sells that lives in
 * exactly one table (candidate-plan.policy.ts). A handler-level decorator
 * overrides a class-level one, same precedence as every other metadata
 * decorator in this codebase.
 */
export const RequiresCapability = (capability: CandidateCapability) =>
  SetMetadata(REQUIRES_CAPABILITY_KEY, capability);
