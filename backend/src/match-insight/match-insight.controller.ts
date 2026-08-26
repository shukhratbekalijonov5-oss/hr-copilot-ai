import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { MatchInsightService } from './match-insight.service';
import {
  CompareInsightsDto,
  RunMatchInsightDto,
} from './dto/match-insight.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { Role } from '../generated/prisma/enums';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

/**
 * HR advanced match: vacancy-context candidate assessment and Compare
 * intelligence, computed by the same engine as the candidate's Internal AI
 * Job Match. Candidate and vacancy come from the path; the organization from
 * the authenticated user; the vacancy must be the caller's OWN (evidence-map
 * rules). Stateless: every call recomputes from current data.
 */
@OrgScoped()
@Controller()
export class MatchInsightController {
  constructor(private readonly service: MatchInsightService) {}

  /** Full advanced assessment of one applicant against one owned vacancy. */
  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @Post('candidates/:candidateId/vacancies/:vacancyId/match-insight')
  assess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Param('vacancyId', ParseUUIDPipe) vacancyId: string,
    @Body() dto: RunMatchInsightDto,
  ) {
    return this.service.assess(
      user.organizationId!,
      user.id,
      candidateId,
      vacancyId,
      dto.locale ?? 'en',
    );
  }

  /** 2–5 applicants side by side, with deterministic superlatives. */
  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @Post('vacancies/:vacancyId/compare-insights')
  compare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vacancyId', ParseUUIDPipe) vacancyId: string,
    @Body() dto: CompareInsightsDto,
  ) {
    return this.service.compare(
      user.organizationId!,
      user.id,
      vacancyId,
      dto.candidateIds,
      dto.locale ?? 'en',
    );
  }
}
