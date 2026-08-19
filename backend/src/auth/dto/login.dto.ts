import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  /** Optional friendly label for the session ("Pixel 9", "Work laptop"). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}
