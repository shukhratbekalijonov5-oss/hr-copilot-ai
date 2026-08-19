import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DocumentType } from '../../generated/prisma/enums';

/**
 * Multipart form fields accompanying the uploaded file.
 * The file itself is validated separately (MIME + size) in DocumentsService.
 */
export class UploadDocumentDto {
  @IsOptional()
  @IsUUID()
  candidateId?: string;

  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;
}
