import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ProcessingService } from './processing.service';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { ProcessingJobStatus } from '../generated/prisma/enums';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

class QueryProcessingJobsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ProcessingJobStatus)
  status?: ProcessingJobStatus;

  /** Filter to candidates of ONE of the caller's own vacancies. */
  @IsOptional()
  @IsUUID()
  vacancyId?: string;
}

@OrgScoped()
@Controller('processing-jobs')
export class ProcessingController {
  constructor(private readonly processingService: ProcessingService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryProcessingJobsDto,
  ) {
    return this.processingService.findAll(
      user.organizationId!,
      user.id,
      query.page,
      query.limit,
      query.status,
      query.vacancyId,
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.processingService.findOne(organizationId, id);
  }
}
