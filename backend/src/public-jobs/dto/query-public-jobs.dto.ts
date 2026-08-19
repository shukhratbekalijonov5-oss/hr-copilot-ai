import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/** Modest public filtering for the MVP: text search and location. */
export class QueryPublicJobsDto extends PaginationQueryDto {
  /** Matches title and description. */
  @IsOptional() @IsString() @MaxLength(200) search?: string;

  @IsOptional() @IsString() @MaxLength(120) location?: string;
}
