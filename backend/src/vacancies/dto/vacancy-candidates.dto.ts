import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ApplicationStatus } from '../../generated/prisma/enums';
import { MAX_BULK_DELETE_VACANCIES } from '../../common/vacancy-access/vacancy-policy';

/** Filters for the candidates working inside ONE selected vacancy. */
export class QueryVacancyCandidatesDto extends PaginationQueryDto {
  /** Matches candidate fullName or email. */
  @IsOptional() @IsString() @MaxLength(200) search?: string;

  /** Pipeline stage within THIS vacancy. */
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}

/**
 * An explicit, bounded selection of the caller's OWN vacancies to delete.
 * All-or-nothing: one foreign or non-owned id fails the whole batch.
 */
export class BulkDeleteVacanciesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_DELETE_VACANCIES)
  @IsUUID(undefined, { each: true })
  vacancyIds!: string[];
}
