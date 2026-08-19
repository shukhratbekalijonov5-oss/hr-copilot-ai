import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApplicationStatus } from '../../generated/prisma/enums';

/** Attaches an existing candidate to an existing vacancy. */
export class CreateApplicationDto {
  @IsUUID()
  vacancyId!: string;

  @IsUUID()
  candidateId!: string;

  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
