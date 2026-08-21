import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { QueryApplicationsDto } from './dto/query-applications.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { Role } from '../generated/prisma/enums';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

/**
 * The recruiter's view of a hiring pipeline.
 *
 * There is deliberately no POST: an application is created by the candidate
 * applying (POST /public/jobs/:slug/apply), never by a recruiter attaching
 * somebody to their vacancy. HR reads the applications that arrived and moves
 * them through stages.
 */
@OrgScoped()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get()
  findAll(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: QueryApplicationsDto,
  ) {
    return this.applicationsService.findAll(organizationId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.applicationsService.findOne(organizationId, id);
  }

  /**
   * The interview invitation: moves the pipeline to INTERVIEW and unlocks
   * (or idempotently returns) the ONE conversation for this vacancy +
   * candidate-account pair. Every applicant owns a platform account, so the
   * conversation is always created.
   */
  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Post(':id/invite-interview')
  inviteToInterview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.applicationsService.inviteToInterview(
      user.organizationId!,
      user.id,
      id,
    );
  }

  /** Manual stage change by an HR user. */
  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    return this.applicationsService.updateStatus(
      user.organizationId!,
      user.id,
      id,
      dto.status,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.applicationsService.remove(user.organizationId!, user.id, id);
  }
}
