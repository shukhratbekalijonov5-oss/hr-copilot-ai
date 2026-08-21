import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import {
  BulkDeleteVacanciesDto,
  QueryVacancyCandidatesDto,
} from './dto/vacancy-candidates.dto';
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

  /**
   * MY VACANCIES — only vacancies the caller personally created in the
   * active organization. The selector source for the whole HR workspace.
   * Declared before ':id' so the literal path wins route matching.
   */
  @Get('mine')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryVacanciesDto,
  ) {
    return this.vacanciesService.findMine(user.organizationId!, user.id, query);
  }

  /**
   * Bulk delete of an explicit selection of OWN vacancies. All-or-nothing;
   * POST (not DELETE) because the selection travels in the body.
   */
  @Roles(Role.OWNER, Role.HR_ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('bulk-delete')
  bulkDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkDeleteVacanciesDto,
  ) {
    return this.vacanciesService.bulkRemove(
      user.organizationId!,
      user.id,
      dto.vacancyIds,
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.findOne(organizationId, id);
  }

  /** The candidates working inside ONE selected (owned) vacancy. */
  @Get(':id/candidates')
  listCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryVacancyCandidatesDto,
  ) {
    return this.vacanciesService.listVacancyCandidates(
      user.organizationId!,
      user.id,
      id,
      query,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVacancyDto,
  ) {
    return this.vacanciesService.update(user.organizationId!, user.id, id, dto);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id/close')
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.setStatus(
      user.organizationId!,
      user.id,
      id,
      VacancyStatus.CLOSED,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Patch(':id/archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.setStatus(
      user.organizationId!,
      user.id,
      id,
      VacancyStatus.ARCHIVED,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.vacanciesService.remove(user.organizationId!, user.id, id);
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
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobRequirementDto,
  ) {
    return this.vacanciesService.addRequirement(
      user.organizationId!,
      user.id,
      id,
      dto,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id/requirements/:requirementId')
  updateRequirement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Body() dto: UpdateJobRequirementDto,
  ) {
    return this.vacanciesService.updateRequirement(
      user.organizationId!,
      user.id,
      id,
      requirementId,
      dto,
    );
  }

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Delete(':id/requirements/:requirementId')
  removeRequirement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
  ) {
    return this.vacanciesService.removeRequirement(
      user.organizationId!,
      user.id,
      id,
      requirementId,
    );
  }
}
