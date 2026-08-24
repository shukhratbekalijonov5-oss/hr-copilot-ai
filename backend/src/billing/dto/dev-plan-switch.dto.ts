import { IsIn, IsString } from 'class-validator';
import { CANDIDATE_PLANS } from '../../entitlements/candidate-plan.policy';
import type { CandidatePlan } from '../../generated/prisma/enums';

/**
 * The QA plan switch takes a target plan and nothing else. No userId — the
 * caller can only ever switch the account they are authenticated as.
 */
export class DevPlanSwitchDto {
  @IsString()
  @IsIn(CANDIDATE_PLANS)
  plan!: CandidatePlan;
}
