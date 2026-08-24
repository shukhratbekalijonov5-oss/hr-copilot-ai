import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';
import { DevPlanSwitchDto } from './dto/dev-plan-switch.dto';
import { DowngradeDto } from './dto/downgrade.dto';
import { CancelDto } from './dto/cancel.dto';
import { DevEnvironmentGuard } from './dev-environment.guard';
import { CandidateScoped } from '../common/decorators/candidate-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * Browser-facing billing (BFF). @CandidateScoped like every self-service
 * candidate surface: a live CANDIDATE account is required, an ORGANIZATION
 * account gets 403 whatever its token says.
 *
 * There is no :userId anywhere — the subject is always the caller. The
 * Java Payment Service, its port and its service token stay entirely
 * behind these routes.
 */
@CandidateScoped()
@Controller('candidate-account/me/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** The caller's billing state, read from the billing authority. */
  @Get()
  summary(@CurrentUser('id') userId: string) {
    return this.billing.summary(userId);
  }

  /**
   * Start a checkout for the caller. 200 (not 201): an idempotent retry
   * returns the SAME logical checkout with `reused: true`, and "created vs
   * fetched" is exactly what the response's `reused` field states.
   */
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  checkout(
    @CurrentUser('id') userId: string,
    @Body() dto: CheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.billing.checkout(userId, dto.plan, idempotencyKey);
  }

  /**
   * Cancel the caller's paid subscription AT PERIOD END. Paid access runs
   * to `effectiveUntil`; nothing is revoked or deleted now. Idempotent —
   * cancelling an already-cancelling subscription changes nothing.
   */
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser('id') userId: string,
    // Present only so ValidationPipe rejects any smuggled field with 400.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() _body: CancelDto,
  ) {
    return this.billing.cancel(userId);
  }

  /**
   * Schedule a downgrade at period end (MAX→PRO), or — for plan FREE —
   * cancel-at-period-end, which is what leaving paid entirely means. Paid
   * access already bought is never cut short.
   */
  @Post('downgrade')
  @HttpCode(HttpStatus.OK)
  downgrade(@CurrentUser('id') userId: string, @Body() dto: DowngradeDto) {
    return this.billing.downgrade(userId, dto.plan);
  }

  /**
   * QA-only plan switch for the caller's own account. DevEnvironmentGuard
   * makes this route answer 404 in production — and the Java endpoint
   * behind it does not exist there either.
   */
  @Post('dev-plan-switch')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevEnvironmentGuard)
  devPlanSwitch(
    @CurrentUser('id') userId: string,
    @Body() dto: DevPlanSwitchDto,
  ) {
    return this.billing.devPlanSwitch(userId, dto.plan);
  }
}
