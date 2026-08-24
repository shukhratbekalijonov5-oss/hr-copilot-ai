import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  PayPeriod,
  SeniorityLevel,
  WorkMode,
  EmploymentType,
} from '../../generated/prisma/enums';
import {
  ISO_COUNTRY_PATTERN,
  PREFERENCE_LIMITS,
  SUPPORTED_CURRENCIES,
} from '../../common/vacancy/job-vocabulary';

/** `a,b,c` or a repeated key, both to a string[]. */
const asList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item : ''))
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const cleaned = raw.map((item) => item.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
};

/**
 * What a job seeker is looking for RIGHT NOW.
 *
 * Every field here is an explicit request. Saved preferences are never read on
 * this endpoint — it is `@Public()`, so it has no candidate to read them for,
 * and that separation is deliberate: the candidate-side page resolves saved
 * intent into these parameters (request beating preference, per dimension) and
 * sends the result. Searching therefore cannot mutate, leak or depend on a
 * stored preference, and an anonymous visitor and a signed-in candidate asking
 * the same question get the same answer.
 *
 * Empty means "no restriction on this dimension" everywhere, never "match
 * nothing".
 */
export class QueryPublicJobsDto extends PaginationQueryDto {
  /** Matches title and description. */
  @IsOptional() @IsString() @MaxLength(200) search?: string;

  /** LEGACY free-text place, kept because most vacancies predate `country`. */
  @IsOptional() @IsString() @MaxLength(120) location?: string;

  /**
   * The location chosen for THIS search — ISO 3166-1 alpha-2. HARD.
   *
   * The one secondary dimension that genuinely restricts. Someone who picks
   * Seoul is asking to see Seoul jobs, and showing them Toronto would be
   * ignoring what they said. Everything else on this DTO only reorders.
   *
   * A saved country preference must NOT be sent here — see
   * `preferredCountries`.
   */
  @IsOptional()
  @Transform(asList)
  @IsArray()
  @Matches(ISO_COUNTRY_PATTERN, { each: true })
  countries?: string[];

  /**
   * A SAVED location preference — SOFT, ranking only.
   *
   * Separate from `countries` because the two mean different things and
   * merging them loses the difference: a candidate whose profile says Seoul
   * who searches "Backend Engineer" has asked about backend engineering, not
   * about Seoul. Their saved city ranks Seoul roles first; it never hides
   * Toronto. Only a location picked for the current search restricts.
   */
  @IsOptional()
  @Transform(asList)
  @IsArray()
  @Matches(ISO_COUNTRY_PATTERN, { each: true })
  preferredCountries?: string[];

  /**
   * SOFT. Selecting Remote ranks remote roles first; it does not delete the
   * hybrid and on-site jobs that answer the same search.
   */
  @IsOptional()
  @Transform(asList)
  @IsArray()
  @IsEnum(WorkMode, { each: true })
  workModes?: WorkMode[];

  @IsOptional()
  @Transform(asList)
  @IsArray()
  @IsEnum(EmploymentType, { each: true })
  employmentTypes?: EmploymentType[];

  @IsOptional()
  @Transform(asList)
  @IsArray()
  @IsEnum(SeniorityLevel, { each: true })
  seniorityLevels?: SeniorityLevel[];

  /**
   * A pay floor, in `salaryCurrency` per `payPeriod`.
   *
   * Applied across currencies through the FX snapshot, so a KRW job can answer
   * a USD question. Jobs whose pay is unstated, or quoted in a currency the
   * snapshot does not cover, are RETAINED rather than dropped — the candidate
   * asked to exclude jobs that pay too little, not jobs we could not read.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PREFERENCE_LIMITS.maxSalary)
  salaryMin?: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  salaryCurrency?: string;

  @IsOptional()
  @IsEnum(PayPeriod)
  payPeriod?: PayPeriod;
}
