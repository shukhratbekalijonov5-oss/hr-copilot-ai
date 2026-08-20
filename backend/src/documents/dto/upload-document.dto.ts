import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { DocumentType } from '../../generated/prisma/enums';

/**
 * Multipart form fields accompanying the uploaded file.
 * The file itself is validated separately (MIME + size) in DocumentsService.
 *
 * `candidateId` is REQUIRED: there is no generic organization upload. Every
 * HR document belongs to a specific manually added candidate of the caller's
 * organization (see document-policy.ts); the service additionally verifies
 * the candidate is eligible.
 */
export class UploadDocumentDto {
  @IsUUID()
  candidateId!: string;

  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;
}
