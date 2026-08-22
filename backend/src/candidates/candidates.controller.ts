import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CandidatesService } from './candidates.service';
import { UpdateCandidateDto } from './dto/update-candidate.dto';
import { QueryCandidatesDto } from './dto/query-candidates.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { Role } from '../generated/prisma/enums';

/**
 * Recruiter-side candidate READS and edits.
 *
 * There is deliberately no POST: HR cannot create a candidate. A candidate
 * record exists because a person with a CandidateAccount applied to a vacancy
 * (see PublicJobsService.apply) — that is the product's only candidate-entry
 * path. Every route below is additionally filtered to real applicants.
 */
@OrgScoped()
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get()
  findAll(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: QueryCandidatesDto,
  ) {
    return this.candidatesService.findAll(organizationId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.candidatesService.findOne(organizationId, id);
  }

  /**
   * The applicant's CURRENT profile and evidence (live account data), behind
   * the full vacancy-contextual chain: the vacancy must be the caller's own
   * and the candidate must have legitimately applied to it. Read-only — there
   * is deliberately no write counterpart to anything returned here.
   */
  @Get(':id/current-evidence')
  currentEvidence(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('vacancyId', ParseUUIDPipe) vacancyId: string,
  ) {
    return this.candidatesService.getCurrentEvidence(
      userId,
      organizationId,
      id,
      vacancyId,
    );
  }

  /** Signed URL for one CURRENT document, same chain plus live ownership. */
  @Get(':id/current-documents/:documentId/download-url')
  currentDocumentDownload(
    @CurrentUser('id') userId: string,
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query('vacancyId', ParseUUIDPipe) vacancyId: string,
  ) {
    return this.candidatesService.getCurrentDocumentDownload(
      userId,
      organizationId,
      id,
      vacancyId,
      documentId,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id')
  update(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCandidateDto,
  ) {
    return this.candidatesService.update(organizationId, id, dto);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Delete(':id')
  remove(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.candidatesService.remove(organizationId, id);
  }
}
