import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { VacancyStatus } from '../../generated/prisma/enums';

export class QueryVacanciesDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(VacancyStatus)
  status?: VacancyStatus;

  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsString() @MaxLength(120) location?: string;

  /** Free-text match against title and description. */
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
