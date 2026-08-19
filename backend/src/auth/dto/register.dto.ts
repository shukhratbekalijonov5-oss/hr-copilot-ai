import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Registers a brand-new organization together with its OWNER user.
 *
 * There is deliberately no `organizationId` field: the organization is created
 * here, and for every other endpoint the tenant comes from the JWT.
 */
export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  organizationName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'organizationSlug must be lowercase alphanumeric words joined by hyphens',
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
}
