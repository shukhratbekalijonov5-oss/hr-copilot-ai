import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { DocumentStatus, DocumentType } from '../../generated/prisma/enums';

export class QueryDocumentsDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() candidateId?: string;

  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;
}
