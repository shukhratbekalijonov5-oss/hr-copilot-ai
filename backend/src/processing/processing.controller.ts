import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsEnum, IsOptional } from 'class-validator';
import { ProcessingService } from './processing.service';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ProcessingJobStatus } from '../generated/prisma/enums';

class QueryProcessingJobsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ProcessingJobStatus)
  status?: ProcessingJobStatus;
}

@Controller('processing-jobs')
export class ProcessingController {
  constructor(private readonly processingService: ProcessingService) {}

  @Get()
  findAll(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: QueryProcessingJobsDto,
  ) {
    return this.processingService.findAll(
      organizationId,
      query.page,
      query.limit,
      query.status,
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
