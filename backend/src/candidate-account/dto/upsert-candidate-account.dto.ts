import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProfileVisibility } from '../../generated/prisma/enums';

/**
 * One period of work experience, as the candidate states it. Free-form dates
 * ("2021", "2021-03", "现在") are allowed on purpose — resumes are not forms,
 * and Korean/Russian/Uzbek text must pass through untouched.
 */
export class ExperienceEntryDto {
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsOptional() @IsString() @MaxLength(40) startDate?: string;
  @IsOptional() @IsString() @MaxLength(40) endDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class EducationEntryDto {
  @IsString() @MinLength(1) @MaxLength(160) institution!: string;
  @IsOptional() @IsString() @MaxLength(160) degree?: string;
  @IsOptional() @IsString() @MaxLength(160) field?: string;
  @IsOptional() @IsInt() @Min(1900) @Max(2100) startYear?: number;
  @IsOptional() @IsInt() @Min(1900) @Max(2100) endYear?: number;
}

/**
 * Create/update payload for the caller's own CandidateAccount. Every field is
 * optional — an empty POST creates a blank profile the user fills in later.
 * There is deliberately no userId anywhere: self-service only.
 */
export class UpsertCandidateAccountDto {
  @IsOptional() @IsString() @MaxLength(160) headline?: string;
  @IsOptional() @IsString() @MaxLength(160) location?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(4000) summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  skills?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ExperienceEntryDto)
  experience?: ExperienceEntryDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EducationEntryDto)
  education?: EducationEntryDto[];

  @IsOptional()
  @IsEnum(ProfileVisibility)
  profileVisibility?: ProfileVisibility;
}
