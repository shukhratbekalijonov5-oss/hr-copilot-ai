import { IsIn, IsString } from 'class-validator';
import { CANDIDATE_PLANS } from '../../entitlements/candidate-plan.policy';
import type { CandidatePlan } from '../../generated/prisma/enums';

/**
 * Everything a browser may say about a checkout: the plan it wants. The
 * subject is ALWAYS the authenticated caller — there is deliberately no
 * userId field, and an unknown plan dies here as a 400 before any code
 * runs. (FREE passes the shape check and is refused by the service with a
 * distinct 422: "not a plan" and "not purchasable" are different answers.)
 */
export class CheckoutDto {
  @IsString()
  @IsIn(CANDIDATE_PLANS)
  plan!: CandidatePlan;
}
