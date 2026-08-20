import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountType } from '../../generated/prisma/enums';

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  /**
   * Which sign-in door this request came through (Candidate vs Organization
   * sign-in). When present and the credentials belong to the OTHER account
   * type, login fails with 403 AUTH_ACCOUNT_TYPE_MISMATCH — but only AFTER
   * the password verified, so the distinction is never disclosed to someone
   * without valid credentials. Omitted: signs in as whatever the account is
   * (single shared form / API clients).
   */
  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  /** Optional friendly label for the session ("Pixel 9", "Work laptop"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}
