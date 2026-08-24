import { ForbiddenException } from '@nestjs/common';
import {
  CANDIDATE_CAPABILITIES,
  CANDIDATE_PLANS,
  hasCapability,
  planUpgradeRequired,
  requiredPlanFor,
} from './candidate-plan.policy';
import type { CandidatePlan } from '../generated/prisma/enums';

/**
 * The plan matrix, pinned. This table IS the product: a change here is a
 * pricing decision, and this spec exists so it can only be made on purpose.
 */
describe('the FREE / PRO / MAX capability matrix', () => {
  const MATRIX: [CandidatePlan, string, boolean][] = [
    ['FREE', 'INTERNAL_AI_SEARCH', false],
    ['FREE', 'EXTERNAL_AI_SEARCH', false],
    ['PRO', 'INTERNAL_AI_SEARCH', true],
    ['PRO', 'EXTERNAL_AI_SEARCH', false],
    ['MAX', 'INTERNAL_AI_SEARCH', true],
    ['MAX', 'EXTERNAL_AI_SEARCH', true],
  ];

  it.each(MATRIX)('%s → %s = %s', (plan, capability, expected) => {
    expect(hasCapability(plan, capability as 'INTERNAL_AI_SEARCH')).toBe(
      expected,
    );
  });

  it('covers every plan and capability exactly once', () => {
    expect(MATRIX).toHaveLength(
      CANDIDATE_PLANS.length * CANDIDATE_CAPABILITIES.length,
    );
  });

  it('tiers are cumulative — a higher plan never loses a capability', () => {
    for (let i = 1; i < CANDIDATE_PLANS.length; i += 1) {
      for (const capability of CANDIDATE_CAPABILITIES) {
        if (hasCapability(CANDIDATE_PLANS[i - 1], capability)) {
          expect(hasCapability(CANDIDATE_PLANS[i], capability)).toBe(true);
        }
      }
    }
  });

  it('fails CLOSED for a plan value this deploy does not know', () => {
    // A future tier read by an old deploy grants nothing, not everything.
    expect(
      hasCapability('ENTERPRISE' as CandidatePlan, 'EXTERNAL_AI_SEARCH'),
    ).toBe(false);
  });
});

describe('the upgrade prompt', () => {
  it('names the CHEAPEST plan that grants the capability', () => {
    expect(requiredPlanFor('INTERNAL_AI_SEARCH')).toBe('PRO');
    expect(requiredPlanFor('EXTERNAL_AI_SEARCH')).toBe('MAX');
  });

  it('is a 403 with the stable machine-readable contract', () => {
    const error = planUpgradeRequired('EXTERNAL_AI_SEARCH');
    expect(error).toBeInstanceOf(ForbiddenException);
    // The frontend switches on these three fields and never parses English.
    expect(error.getResponse()).toMatchObject({
      statusCode: 403,
      code: 'PLAN_UPGRADE_REQUIRED',
      requiredPlan: 'MAX',
      capability: 'EXTERNAL_AI_SEARCH',
    });
  });
});
