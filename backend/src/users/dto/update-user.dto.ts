import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../generated/prisma/enums';

/**
 * Deliberately narrow. Email is immutable here (it is the login identity), and
 * there is no organizationId field — a user cannot be moved between tenants.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
