import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Recruiter enrichment of an APPLICANT's org-side record — correcting a
 * mis-parsed title, adding a phone number taken from a call.
 *
 * There is no `vacancyId` and no create counterpart: recruiters cannot bring a
 * candidate into a vacancy, only work with people who applied. The candidate's
 * own CandidateAccount profile is untouched by this — it is theirs.
 */
export class UpdateCandidateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) fullName?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) location?: string;
  @IsOptional() @IsString() @MaxLength(200) currentTitle?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(80)
  totalExperienceYears?: number;
}
