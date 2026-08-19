import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequirementType } from '../../generated/prisma/enums';

export class CreateJobRequirementDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  text!: string;

  @IsOptional()
  @IsEnum(RequirementType)
  type?: RequirementType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class UpdateJobRequirementDto extends PartialType(CreateJobRequirementDto) {}
