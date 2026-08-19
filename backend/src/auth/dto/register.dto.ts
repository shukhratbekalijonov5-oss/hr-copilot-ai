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
 * Registers a User. Two intents, one endpoint:
 *
 *  - Hiring: provide organizationName + organizationSlug (together) — the
 *    organization is created with the caller as its OWNER member.
 *  - Job seeking: omit both — a bare account is created; a CandidateAccount
 *    is added afterwards via POST /candidate-account.
 *
 * There is deliberately no `organizationId` field: joining an EXISTING
 * organization only happens through that organization's own invite flow.
 */
export class RegisterDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  organizationName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'organizationSlug must be lowercase alphanumeric words joined by hyphens',
  })
  organizationSlug?: string;

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
}
