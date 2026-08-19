import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { QueryEvidenceDto } from './dto/query-evidence.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { Role } from '../generated/prisma/enums';

@OrgScoped()
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  /**
   * Ingest endpoint for evidence produced by the AI service. Restricted to
   * privileged roles for now; when the Python service calls it directly this
   * should move behind a dedicated service credential.
   */
  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Post()
  create(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: CreateEvidenceDto,
  ) {
    return this.evidenceService.create(organizationId, dto);
  }

  @Get()
  findAll(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: QueryEvidenceDto,
  ) {
    return this.evidenceService.findAll(organizationId, query);
  }

  @Get('by-candidate/:candidateId')
  findByCandidate(
    @CurrentUser('organizationId') organizationId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Query() query: QueryEvidenceDto,
  ) {
    return this.evidenceService.findByCandidate(
      organizationId,
      candidateId,
      query,
    );
  }

  @Get('by-requirement/:requirementId')
  findByRequirement(
    @CurrentUser('organizationId') organizationId: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Query() query: QueryEvidenceDto,
  ) {
    return this.evidenceService.findByRequirement(
      organizationId,
      requirementId,
      query,
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.evidenceService.findOne(organizationId, id);
  }
}
