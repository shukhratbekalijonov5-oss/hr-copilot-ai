import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { VacancyStatus } from '../../generated/prisma/enums';

export class CreateVacancyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsString() @MaxLength(120) location?: string;
  @IsOptional() @IsString() @MaxLength(60) employmentType?: string;
  @IsOptional() @IsString() @MaxLength(20_000) description?: string;
  @IsOptional() @IsString() @MaxLength(60) experienceLevel?: string;

  @IsOptional()
  @IsEnum(VacancyStatus)
  status?: VacancyStatus;
}
