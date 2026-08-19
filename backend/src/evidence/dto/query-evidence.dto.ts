import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { EvidenceType } from '../../generated/prisma/enums';

export class QueryEvidenceDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() candidateId?: string;
  @IsOptional() @IsUUID() vacancyId?: string;
  @IsOptional() @IsUUID() requirementId?: string;
  @IsOptional() @IsUUID() documentId?: string;

  @IsOptional()
  @IsEnum(EvidenceType)
  evidenceType?: EvidenceType;
}
