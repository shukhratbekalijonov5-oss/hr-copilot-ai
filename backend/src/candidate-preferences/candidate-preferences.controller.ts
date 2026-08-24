import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { CandidatePreferencesService } from './candidate-preferences.service';
import { PutJobPreferencesDto } from './dto/job-preferences.dto';
import { JobSearchContextQueryDto } from './dto/job-search-context.dto';
import { buildJobSearchContext } from './job-search-context';
import { CandidateScoped } from '../common/decorators/candidate-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * The candidate's own job preferences.
 *
 * @CandidateScoped, like the rest of the self-service surface: an ORGANIZATION
 * account is refused whatever its token claims, and an unauthenticated request
 * never reaches the handler. There is no account id in any path, body or query
 * — the subject is always the caller, resolved from the authenticated user, so
 * reading or writing someone else's preferences is not expressible.
 */
@CandidateScoped()
@Controller('candidate-account/me/job-preferences')
export class CandidatePreferencesController {
  constructor(private readonly service: CandidatePreferencesService) {}

  /** The caller's stated preferences; an empty shape when they have none. */
  @Get()
  async get(@CurrentUser('id') userId: string) {
    return this.service.getMine(await this.service.requireAccountId(userId));
  }

  /**
   * Replaces the whole preference profile with the body.
   *
   * PUT because a preference profile is a single current statement of intent,
   * not a stream of edits: what arrives is what the candidate now wants, and
   * everything absent from it is not stated. Rule N1 — no previous version
   * survives anywhere after this returns.
   */
  @Put()
  async replace(
    @CurrentUser('id') userId: string,
    @Body() dto: PutJobPreferencesDto,
  ) {
    return this.service.replace(
      await this.service.requireAccountId(userId),
      dto,
    );
  }

  /** Removes the profile entirely; the candidate returns to having stated nothing. */
  @Delete()
  async remove(@CurrentUser('id') userId: string) {
    return this.service.remove(await this.service.requireAccountId(userId));
  }

  /**
   * The canonical intent for one search, with each dimension labelled by where
   * it came from.
   *
   * This is the shared boundary every candidate→jobs surface reads instead of
   * interpreting the preference tables itself. Passing filters here resolves
   * them against the saved intent by precedence (request beats preference beats
   * no restriction) WITHOUT writing anything: running a search never edits what
   * the candidate said they want.
   *
   * Nothing in the response is applied as a filter or a score yet — that is
   * Task 3's decision, and this endpoint is what it will build on.
   */
  @Get('search-context')
  async searchContext(
    @CurrentUser('id') userId: string,
    @Query() query: JobSearchContextQueryDto,
  ) {
    const accountId = await this.service.requireAccountId(userId);
    const intent = await this.service.resolveIntent(accountId);
    return buildJobSearchContext(
      intent,
      {
        query: query.query ?? null,
        countries: query.countries,
        workModes: query.workModes,
        employmentTypes: query.employmentTypes,
        seniorityLevels: query.seniorityLevels,
        // Only a COMPLETE triple counts as an explicit pay filter. A partial
        // one is not a weaker filter, it is not a filter — and mixing a
        // requested currency with a saved amount would produce a figure the
        // candidate never stated.
        minCompensation:
          query.salaryMin && query.salaryCurrency && query.payPeriod
            ? {
                minAmount: query.salaryMin,
                maxAmount: null,
                currency: query.salaryCurrency,
                payPeriod: query.payPeriod,
              }
            : undefined,
      },
      query.locale ?? 'en',
    );
  }
}
