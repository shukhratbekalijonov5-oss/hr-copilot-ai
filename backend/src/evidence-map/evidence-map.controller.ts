import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { EvidenceMapService } from './evidence-map.service';
import { RunEvidenceMapDto } from './dto/evidence-map.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { Role } from '../generated/prisma/enums';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

/**
 * JD -> candidate evidence mapping.
 *
 * Candidate and vacancy come from the path; the organization comes from the
 * authenticated user. A client cannot address another tenant's data, and both
 * ids are verified against the caller's organization before anything runs.
 */
@OrgScoped()
@Controller('candidates/:candidateId/vacancies/:vacancyId/evidence-map')
export class EvidenceMapController {
  constructor(private readonly evidenceMapService: EvidenceMapService) {}

  /** Runs (or re-runs) the mapping. Safe to repeat — results are replaced. */
  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @Post()
  run(
    @CurrentUser() user: AuthenticatedUser,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Param('vacancyId', ParseUUIDPipe) vacancyId: string,
    @Body() dto: RunEvidenceMapDto,
  ) {
    return this.evidenceMapService.run(
      user.organizationId!,
      user.id,
      candidateId,
      vacancyId,
      dto.locale ?? 'en',
    );
  }

  /** Reads the stored mapping. Every requirement is listed, mapped or not. */
  @Get()
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Param('vacancyId', ParseUUIDPipe) vacancyId: string,
  ) {
    return this.evidenceMapService.read(
      user.organizationId!,
      user.id,
      candidateId,
      vacancyId,
    );
  }
}
