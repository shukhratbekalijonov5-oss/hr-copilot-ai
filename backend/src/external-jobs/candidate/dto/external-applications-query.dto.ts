import { IsIn, IsOptional } from 'class-validator';
import { PagedQueryDto } from './paged-query.dto';
import { EXTERNAL_APPLICATION_STATUSES } from '../external-application.policy';
import type { ExternalApplicationStatus } from '../../../generated/prisma/enums';

/** The tracking list: paginated, optionally narrowed to one status. */
export class ExternalApplicationsQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsIn(EXTERNAL_APPLICATION_STATUSES)
  status?: ExternalApplicationStatus;
}
