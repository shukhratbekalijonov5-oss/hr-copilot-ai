import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  EmploymentType,
  JobBenefit,
  PayPeriod,
  SeniorityLevel,
  WorkMode,
} from '../../generated/prisma/enums';
import {
  ISO_COUNTRY_PATTERN,
  MAX_PREFERENCE_ENTRY_LENGTH,
  PREFERENCE_LIMITS,
  SUPPORTED_CURRENCIES,
} from '../../common/vacancy/job-vocabulary';

/**
 * One place the candidate wants — or refuses.
 *
 * The country is the canonical part; region and city are the candidate's own
 * words, kept in their country's context so "Cambridge" is never ambiguous.
 * Nothing here is geocoded and the API does not pretend otherwise.
 */
export class PreferredLocationDto {
  @Matches(ISO_COUNTRY_PATTERN, {
    message:
      'countryCode must be an uppercase ISO 3166-1 alpha-2 code, e.g. "KR"',
  })
  countryCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PREFERENCE_ENTRY_LENGTH)
  region?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PREFERENCE_ENTRY_LENGTH)
  city?: string | null;
}

/**
 * The candidate's COMPLETE current job intent.
 *
 * PUT semantics, deliberately: the body is the whole preference profile as it
 * should now stand, and anything absent is not stated. An absent list is an
 * empty list; an absent scalar is null. There is no "leave this one alone"
 * — that ambiguity is exactly what makes a preferences API impossible to
 * reason about, and Rule N1 wants one unmistakable current state rather than
 * an accumulation of partial edits.
 *
 * Empty and null are MEANINGFUL, not missing: `preferredWorkModes: []` is
 * "stated no work-mode preference" and never "rejects every work mode";
 * `desiredSalaryMin: null` is "named no threshold" and never zero;
 * `willingToRelocate: null` is "did not say" and never false.
 *
 * Nothing here may be filled in on the candidate's behalf. A preference exists
 * because the candidate stated it — never because a resume, an application, a
 * past search or a model suggested it.
 */
export class PutJobPreferencesDto {
  /**
   * Desired ROLES, not skills. "DevOps Engineer" is a preference;
   * "Kubernetes" is evidence and belongs nowhere near this field.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.maxJobTitles)
  @IsString({ each: true })
  @MaxLength(MAX_PREFERENCE_ENTRY_LENGTH, { each: true })
  preferredJobTitles?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.maxLocations)
  @ValidateNested({ each: true })
  @Type(() => PreferredLocationDto)
  preferredLocations?: PreferredLocationDto[];

  @IsOptional()
  @IsArray()
  @IsEnum(WorkMode, { each: true })
  preferredWorkModes?: WorkMode[];

  @IsOptional()
  @IsArray()
  @IsEnum(EmploymentType, { each: true })
  preferredEmploymentTypes?: EmploymentType[];

  @IsOptional()
  @IsArray()
  @IsEnum(SeniorityLevel, { each: true })
  preferredSeniorityLevels?: SeniorityLevel[];

  /**
   * A FLOOR in major currency units. Null clears the whole compensation
   * preference; a value requires both a currency and a pay period, because a
   * number on its own cannot be compared with any job's pay.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PREFERENCE_LIMITS.maxSalary)
  desiredSalaryMin?: number | null;

  /**
   * The top of the range the candidate had in mind. Optional: many people
   * state only a floor.
   *
   * It is a TARGET, not a limit — a job paying more than this still matches
   * (see SalaryMatcher). Treating it as a ceiling would mean the product
   * quietly deciding that someone should not be shown better-paying work.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PREFERENCE_LIMITS.maxSalary)
  desiredSalaryMax?: number | null;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  salaryCurrency?: string | null;

  @IsOptional()
  @IsEnum(PayPeriod)
  payPeriod?: PayPeriod | null;

  /** Tri-state: true, false, or null for "not stated". */
  @IsOptional()
  @IsBoolean()
  willingToRelocate?: boolean | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.maxIndustries)
  @IsString({ each: true })
  @MaxLength(MAX_PREFERENCE_ENTRY_LENGTH, { each: true })
  preferredIndustries?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(JobBenefit, { each: true })
  preferredBenefits?: JobBenefit[];

  /**
   * Explicit negative intent. Stated by the candidate only — never learned
   * from a dismissal, a skipped card or any other behavioural signal.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.maxExcludedCompanies)
  @IsString({ each: true })
  @MaxLength(MAX_PREFERENCE_ENTRY_LENGTH, { each: true })
  excludedCompanies?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.maxExcludedJobTitles)
  @IsString({ each: true })
  @MaxLength(MAX_PREFERENCE_ENTRY_LENGTH, { each: true })
  excludedJobTitles?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PREFERENCE_LIMITS.maxExcludedLocations)
  @ValidateNested({ each: true })
  @Type(() => PreferredLocationDto)
  excludedLocations?: PreferredLocationDto[];
}
