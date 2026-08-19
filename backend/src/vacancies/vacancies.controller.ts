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
import { VacanciesService } from './vacancies.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { UpdateVacancyDto } from './dto/update-vacancy.dto';
import { QueryVacanciesDto } from './dto/query-vacancies.dto';
import {
  CreateJobRequirementDto,
  UpdateJobRequirementDto,
} from './dto/job-requirement.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { Role, VacancyStatus } from '../generated/prisma/enums';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

/**
 * Every handler takes organizationId from the JWT via @CurrentUser. No route
 * accepts an organizationId parameter — cross-tenant access is not expressible.
 */
@OrgScoped()
@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacanciesService: VacanciesService) {}

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVacancyDto,
  ) {
    return this.vacanciesService.create(user.organizationId!, user.id, dto);
  }

  @Get()
  findAll(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: QueryVacanciesDto,
  ) {
    return this.vacanciesService.findAll(organizationId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.findOne(organizationId, id);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id')
  update(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVacancyDto,
  ) {
    return this.vacanciesService.update(organizationId, id, dto);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id/close')
  close(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.setStatus(
      organizationId,
      id,
      VacancyStatus.CLOSED,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Patch(':id/archive')
  archive(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.setStatus(
      organizationId,
      id,
      VacancyStatus.ARCHIVED,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Delete(':id')
  remove(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.remove(organizationId, id);
  }

  // -- Job requirements ----------------------------------------------------

  @Get(':id/requirements')
  listRequirements(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.listRequirements(organizationId, id);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Post(':id/requirements')
  addRequirement(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobRequirementDto,
  ) {
    return this.vacanciesService.addRequirement(organizationId, id, dto);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id/requirements/:requirementId')
  updateRequirement(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Body() dto: UpdateJobRequirementDto,
  ) {
    return this.vacanciesService.updateRequirement(
      organizationId,
      id,
      requirementId,
      dto,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Delete(':id/requirements/:requirementId')
  removeRequirement(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
  ) {
    return this.vacanciesService.removeRequirement(
      organizationId,
      id,
      requirementId,
    );
  }
}
