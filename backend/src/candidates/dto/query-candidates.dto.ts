import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Metadata-only search. This is a plain relational filter over fields a human
 * entered or the parser extracted — it is NOT semantic/AI ranking, which will
 * arrive later behind the AI service boundary.
 */
export class QueryCandidatesDto extends PaginationQueryDto {
  /** Matches fullName, email, currentTitle. */
  @IsOptional() @IsString() @MaxLength(200) search?: string;

  @IsOptional() @IsString() @MaxLength(120) location?: string;
  @IsOptional() @IsString() @MaxLength(200) currentTitle?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(80)
  minExperienceYears?: number;
}
