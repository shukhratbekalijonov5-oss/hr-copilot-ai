import { ForbiddenException, HttpStatus } from '@nestjs/common';
import type { CandidatePlan } from '../generated/prisma/enums';

/**
 * THE plan→capability mapping. One table, one file, imported everywhere —
 * never a plan comparison inline in a controller, because entitlement rules
 * that live in route code get out of sync the second a second route needs
 * them.
 *
 * ## The product decision this encodes
 *
 * Internal and external AI job search are SEPARATE PRODUCTS over SEPARATE
 * RANKING UNIVERSES — HR Copilot vacancies on one side, the external
 * catalogue on the other. They are never merged, never blended, and never
 * compete in one ranked list (internal synthetic data and 85–90% internal
 * match scores would dominate any mixed ordering; the two sides also differ
 * in provenance, freshness and apply semantics). The tiers sell them
 * separately:
 *
 *   FREE — ordinary internal job search and applying. No AI surfaces.
 *   PRO  — + INTERNAL_AI_SEARCH: the AI Job Match over internal vacancies.
 *   MAX  — + EXTERNAL_AI_SEARCH: the External Jobs product in full — search,
 *          detail, saved jobs, apply tracking (and later Task 4C.6's Gemini
 *          explanations, which will hang off the same capability).
 *
 * Saved external jobs and external apply tracking are deliberately part of
 * EXTERNAL_AI_SEARCH rather than free-floating: they are features OF the
 * external product, and a FREE account that cannot see external search
 * results has nothing to honestly save or track.
 */
export const CANDIDATE_PLANS = ['FREE', 'PRO', 'MAX'] as const;

export const CANDIDATE_CAPABILITIES = [
  'INTERNAL_AI_SEARCH',
  'EXTERNAL_AI_SEARCH',
] as const;

export type CandidateCapability = (typeof CANDIDATE_CAPABILITIES)[number];

const PLAN_CAPABILITIES: Record<
  CandidatePlan,
  Record<CandidateCapability, boolean>
> = {
  FREE: { INTERNAL_AI_SEARCH: false, EXTERNAL_AI_SEARCH: false },
  PRO: { INTERNAL_AI_SEARCH: true, EXTERNAL_AI_SEARCH: false },
  MAX: { INTERNAL_AI_SEARCH: true, EXTERNAL_AI_SEARCH: true },
};

export function hasCapability(
  plan: CandidatePlan,
  capability: CandidateCapability,
): boolean {
  // An unknown plan value (a future tier read by an old deploy) grants
  // NOTHING rather than everything — fail closed.
  return PLAN_CAPABILITIES[plan]?.[capability] === true;
}

/**
 * Every capability a plan grants, in declaration order — what `/auth/me`
 * publishes so the UI can lock features BEFORE a 403. Derived from the same
 * table the guard enforces with, so the read contract and the enforcement
 * cannot disagree; an unknown plan value yields [] (fail closed), never a
 * guess.
 */
export function grantedCapabilities(
  plan: CandidatePlan,
): CandidateCapability[] {
  return CANDIDATE_CAPABILITIES.filter((capability) =>
    hasCapability(plan, capability),
  );
}

/**
 * The cheapest plan that grants a capability — what an upgrade prompt should
 * name. Derived from the table so the two can never disagree.
 */
export function requiredPlanFor(
  capability: CandidateCapability,
): CandidatePlan {
  for (const plan of CANDIDATE_PLANS) {
    if (PLAN_CAPABILITIES[plan][capability]) return plan;
  }
  // Unreachable while every capability is granted by some plan; MAX is the
  // safe answer if a capability is ever temporarily granted by none.
  return 'MAX';
}

/** The stable machine-readable code the frontend switches on. */
export const PLAN_UPGRADE_REQUIRED = 'PLAN_UPGRADE_REQUIRED';

/**
 * The one 403 every entitlement refusal uses.
 *
 * Same envelope convention as auth-errors.ts: the object body passes through
 * AllExceptionsFilter verbatim, `code` + the structured fields are the
 * contract, and the English message is a developer courtesy the frontend
 * must never parse.
 */
export function planUpgradeRequired(
  capability: CandidateCapability,
): ForbiddenException {
  const requiredPlan = requiredPlanFor(capability);
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    message: `This feature requires the ${requiredPlan} plan.`,
    code: PLAN_UPGRADE_REQUIRED,
    requiredPlan,
    capability,
  });
}
