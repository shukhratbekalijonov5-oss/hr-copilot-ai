import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ApplicationStatus } from '../../generated/prisma/enums';

export class QueryApplicationsDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() vacancyId?: string;
  @IsOptional() @IsUUID() candidateId?: string;

  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
