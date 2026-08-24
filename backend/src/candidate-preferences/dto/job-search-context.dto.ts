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
import {
  EmploymentType,
  PayPeriod,
  SeniorityLevel,
  WorkMode,
} from '../../generated/prisma/enums';
import {
  ISO_COUNTRY_PATTERN,
  PREFERENCE_LIMITS,
  SUPPORTED_CURRENCIES,
} from '../../common/vacancy/job-vocabulary';
import { SUPPORTED_LOCALES } from '../../ai/ai-service.client';
import type { SupportedLocale } from '../../ai/ai-service.client';

/** `a,b,c` or a repeated query key, both to a string[]. */
const asList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item : ''))
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return raw.map((item) => item.trim()).filter(Boolean);
};

/**
 * REQUEST-level search intent — what the candidate asked for right now.
 *
 * Deliberately mirrors the saved preference dimensions so the two can be
 * resolved against each other, and deliberately does NOT include exclusions:
 * an ad-hoc search must not be able to drop the candidate's standing "never
 * show me this" rules.
 *
 * Nothing sent here is persisted. Searching for Berlin does not make Berlin a
 * preference.
 */
export class JobSearchContextQueryDto {
  @IsOptional() @IsString() @MaxLength(200) query?: string;

  @IsOptional()
  @Transform(asList)
  @IsArray()
  @Matches(ISO_COUNTRY_PATTERN, {
    each: true,
    message: 'countries must be uppercase ISO 3166-1 alpha-2 codes',
  })
  countries?: string[];

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

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: SupportedLocale;

  /**
   * An explicit pay floor for THIS search, with its units.
   *
   * All three travel together and beat the saved expectation as a unit — a
   * request currency with a saved amount would be a figure the candidate
   * never stated in a currency they never chose.
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
