import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Locale } from '../../generated/prisma/enums';

/**
 * Creates a CANDIDATE account: a User plus their CandidateAccount, in one
 * transaction. Never an organization, never a membership — organization
 * onboarding is POST /auth/register/organization, and one email is exactly
 * one of the two.
 */
export class RegisterCandidateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters long' })
  @MaxLength(128)
  password!: string;

  /** One of en/ko/ru/uz. Defaults to en. */
  @IsOptional()
  @IsEnum(Locale)
  preferredLocale?: Locale;

  /** Optional friendly label for the session ("Pixel 9", "Work laptop"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}
