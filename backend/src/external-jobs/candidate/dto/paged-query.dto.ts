import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Pagination for the candidate-owned external-job lists.
 *
 * Same bounds as the search endpoint (`pageSize` ≤ 100) so no list is a way
 * to ask the database for more per request than the search itself allows.
 */
export class PagedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
