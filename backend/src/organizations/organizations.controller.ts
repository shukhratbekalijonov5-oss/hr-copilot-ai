import { Body, Controller, Get, Patch } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { Role } from '../generated/prisma/enums';

/**
 * Routes address "my organization" rather than an id, so there is no parameter
 * a client could tamper with to reach another tenant.
 */
@OrgScoped()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('current')
  findCurrent(@CurrentUser('organizationId') organizationId: string) {
    return this.organizationsService.findCurrent(organizationId);
  }

  @Get('current/stats')
  stats(@CurrentUser('organizationId') organizationId: string) {
    return this.organizationsService.stats(organizationId);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Patch('current')
  updateCurrent(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.updateCurrent(organizationId, dto);
  }
}
