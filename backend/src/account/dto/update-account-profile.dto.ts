import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * The caller's own name and sign-in address.
 *
 * Both fields are optional in the DTO and REQUIRED when present — that is the
 * distinction the product asks for. "Optional" here means "the client may send
 * only the field it changed"; it never means the value may be blank. The
 * whitespace trim runs before validation, so a name of three spaces fails
 * `MinLength` rather than being stored as "   ".
 *
 * There is deliberately no `role`, no `organizationId`, no `accountType` and
 * no `password`: this route edits who you are, never what you may do, and a
 * privilege field accepted here would be a privilege field a user can set on
 * themselves.
 */
export class UpdateAccountProfileDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2, { message: 'Name is required' })
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(1, { message: 'Email is required' })
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string;
}
