import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CitizenshipRequirement,
  EducationLevel,
  HiringUrgency,
  JobBenefit,
  PayPeriod,
  SeniorityLevel,
  VacancyStatus,
  VisaSponsorship,
  WorkMode,
} from '../../generated/prisma/enums';
import {
  ISO_COUNTRY_PATTERN,
  MAX_TAG_LENGTH,
  SUPPORTED_CURRENCIES,
  VACANCY_LIMITS,
  VISA_TYPE_PATTERN,
} from '../../common/vacancy/job-vocabulary';
import { VacancyLanguageRequirementDto } from './vacancy-language.dto';

/**
 * Everything a recruiter can state about a role.
 *
 * ## Absent vs null
 *
 * An ABSENT key means "leave it alone" — a PATCH that sends only
 * `openingsCount` must not wipe the salary. An explicit `null` means "clear
 * it", which is how a recruiter takes back a figure they entered by mistake.
 * `@IsOptional()` skips validation for both, and the service distinguishes
 * them: it copies through only the keys that are not `undefined`.
 *
 * Only `title` is required. Every structured field is optional because an
 * employer who did not state a salary, a work mode or a visa policy must be
 * recorded as not having stated it — never as a default that reads like a
 * commitment. The tri-state booleans (`foreignApplicantsAccepted`,
 * `existingWorkAuthorizationRequired`) exist for exactly that reason.
 *
 * Per-field shape is checked here; rules that span FIELDS (min <= max, a
 * currency for a salary, a nationality list for a citizenship restriction)
 * live in vacancy-profile.validation.ts, because on a PATCH they must be
 * judged against the MERGED row rather than the fragment in the request.
 */
export class CreateVacancyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(120) department?: string | null;
  /**
   * LEGACY free-text location. Superseded by country/region/city + workMode,
   * kept because every vacancy written before the structured fields existed
   * has only this and must keep rendering.
   */
  @IsOptional() @IsString() @MaxLength(120) location?: string | null;
  @IsOptional() @IsString() @MaxLength(60) employmentType?: string | null;
  @IsOptional() @IsString() @MaxLength(20_000) description?: string | null;
  @IsOptional() @IsString() @MaxLength(60) experienceLevel?: string | null;

  @IsOptional()
  @IsEnum(VacancyStatus)
  status?: VacancyStatus;

  // -- Compensation --------------------------------------------------------

  /** Major currency units (55000000 = ₩55,000,000), never minor. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(VACANCY_LIMITS.maxSalary)
  salaryMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(VACANCY_LIMITS.maxSalary)
  salaryMax?: number | null;

  /** ISO-4217 alpha-3 from the supported set — never free text. */
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string | null;

  @IsOptional()
  @IsEnum(PayPeriod)
  payPeriod?: PayPeriod | null;

  @IsOptional()
  @IsBoolean()
  salaryNegotiable?: boolean;

  // -- Location & work arrangement -----------------------------------------

  @IsOptional()
  @Matches(ISO_COUNTRY_PATTERN, {
    message: 'country must be an uppercase ISO 3166-1 alpha-2 code, e.g. "KR"',
  })
  country?: string | null;

  @IsOptional() @IsString() @MaxLength(120) region?: string | null;
  @IsOptional() @IsString() @MaxLength(120) city?: string | null;

  @IsOptional()
  @IsEnum(WorkMode)
  workMode?: WorkMode | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(VACANCY_LIMITS.maxOfficeDaysPerWeek)
  officeDaysPerWeek?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(VACANCY_LIMITS.maxRemoteCountries)
  @Matches(ISO_COUNTRY_PATTERN, { each: true })
  remoteCountriesAllowed?: string[];

  // -- Work authorization ---------------------------------------------------

  /** Tri-state: omitted / null means the employer did not say. */
  @IsOptional()
  @IsBoolean()
  foreignApplicantsAccepted?: boolean | null;

  @IsOptional()
  @IsEnum(VisaSponsorship)
  visaSponsorship?: VisaSponsorship;

  /** Tri-state, same reason as foreignApplicantsAccepted. */
  @IsOptional()
  @IsBoolean()
  existingWorkAuthorizationRequired?: boolean | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(VACANCY_LIMITS.maxVisaTypes)
  @Matches(VISA_TYPE_PATTERN, { each: true })
  eligibleVisaTypes?: string[];

  @IsOptional()
  @IsEnum(CitizenshipRequirement)
  citizenshipRequirement?: CitizenshipRequirement;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(VACANCY_LIMITS.maxNationalities)
  @Matches(ISO_COUNTRY_PATTERN, { each: true })
  eligibleNationalities?: string[];

  // -- Seniority & experience -----------------------------------------------

  @IsOptional()
  @IsEnum(SeniorityLevel)
  seniorityLevel?: SeniorityLevel | null;

  /** Whole years. Sub-year precision is not a distinction job ads make. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(VACANCY_LIMITS.maxExperienceYears)
  minExperienceYears?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(VACANCY_LIMITS.maxExperienceYears)
  preferredExperienceYears?: number | null;

  // -- Education, certifications, domain -------------------------------------

  @IsOptional()
  @IsEnum(EducationLevel)
  requiredEducation?: EducationLevel | null;

  @IsOptional()
  @IsEnum(EducationLevel)
  preferredEducation?: EducationLevel | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(VACANCY_LIMITS.maxCertifications)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  requiredCertifications?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(VACANCY_LIMITS.maxCertifications)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  preferredCertifications?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(VACANCY_LIMITS.maxDomainExperience)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  domainExperience?: string[];

  // -- Benefits --------------------------------------------------------------

  @IsOptional()
  @IsArray()
  @IsEnum(JobBenefit, { each: true })
  benefits?: JobBenefit[];

  /** Only meaningful alongside the OTHER benefit. */
  @IsOptional() @IsString() @MaxLength(200) benefitsOther?: string | null;

  // -- Hiring lifecycle -------------------------------------------------------

  /**
   * A deadline BEFORE the expected start date is normal and stays allowed —
   * applications close, then the person starts.
   */
  @IsOptional()
  @IsDateString()
  applicationDeadline?: string | null;

  @IsOptional()
  @IsDateString()
  expectedStartDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(VACANCY_LIMITS.maxOpeningsCount)
  openingsCount?: number | null;

  @IsOptional()
  @IsEnum(HiringUrgency)
  hiringUrgency?: HiringUrgency | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(VACANCY_LIMITS.maxContractDurationMonths)
  contractDurationMonths?: number | null;

  // -- Languages --------------------------------------------------------------

  /**
   * REPLACES the vacancy's whole language set when present; omit the field to
   * leave it untouched, send `[]` to clear it. A per-row PATCH API would need
   * ids the create form has never seen, and the set is small enough that
   * replace-all is both simpler and free of merge ambiguity.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(VACANCY_LIMITS.maxLanguages)
  @ValidateNested({ each: true })
  @Type(() => VacancyLanguageRequirementDto)
  languages?: VacancyLanguageRequirementDto[];
}
