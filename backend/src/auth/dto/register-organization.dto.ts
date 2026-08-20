import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Locale } from '../../generated/prisma/enums';

/**
 * Creates an ORGANIZATION account: a User, their Organization and its OWNER
 * membership, in one transaction. Never a CandidateAccount — job seeking is
 * POST /auth/register/candidate, and one email is exactly one of the two.
 *
 * There is deliberately no `organizationId` field: joining an EXISTING
 * organization only happens through that organization's own invite flow.
 */
export class RegisterOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  organizationName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'organizationSlug must be lowercase alphanumeric words joined by hyphens',
  })
  organizationSlug!: string;

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
