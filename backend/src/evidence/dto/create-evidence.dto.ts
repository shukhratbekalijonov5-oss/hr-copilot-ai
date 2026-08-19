import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EvidenceType } from '../../generated/prisma/enums';

/**
 * Written by the AI service (via the backend) once it has extracted a passage
 * from a document. Note there is no score/confidence field: evidence is a
 * pointer to text a human can read and judge, not a machine verdict.
 */
export class CreateEvidenceDto {
  @IsUUID()
  candidateId!: string;

  @IsUUID()
  documentId!: string;

  @IsOptional() @IsUUID() vacancyId?: string;
  @IsOptional() @IsUUID() requirementId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNumber?: number;

  @IsOptional() @IsString() @MaxLength(200) section?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  text!: string;

  @IsOptional()
  @IsEnum(EvidenceType)
  evidenceType?: EvidenceType;
}
