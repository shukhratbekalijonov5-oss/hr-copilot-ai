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
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto';
import { QueryApplicationsDto } from './dto/query-applications.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Post()
  create(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreateApplicationDto,
  ) {
    return this.applicationsService.create(organizationId, dto);
  }

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

  /** Manual stage change by an HR user. */
  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Patch(':id/status')
  updateStatus(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationStatusDto,
  ) {
    return this.applicationsService.updateStatus(organizationId, id, dto.status);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Delete(':id')
  remove(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.applicationsService.remove(organizationId, id);
  }
}
