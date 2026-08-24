import { IsIn, IsString } from 'class-validator';
import { CANDIDATE_PLANS } from '../../entitlements/candidate-plan.policy';
import type { CandidatePlan } from '../../generated/prisma/enums';

/**
 * A downgrade names the plan the caller wants to END UP on. FREE means
 * cancel-at-period-end; PRO schedules MAX→PRO. MAX passes the shape check
 * and is refused by the service with a coded 422 — "not a plan" and "not a
 * downgrade target" are different answers, same convention as checkout.
 */
export class DowngradeDto {
  @IsString()
  @IsIn(CANDIDATE_PLANS)
  plan!: CandidatePlan;
}
