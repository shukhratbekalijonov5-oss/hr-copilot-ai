import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsString, Max, Min } from 'class-validator';
import { DocumentStatus } from '../../generated/prisma/enums';

/**
 * Sent by the AI service as each pipeline stage genuinely completes.
 *
 * Only the stages the AI service actually performs are accepted — COMPLETED
 * and FAILED are terminal states owned by the queue worker, which remains the
 * source of truth for whether the job as a whole succeeded.
 */
export const REPORTABLE_STAGES: readonly DocumentStatus[] = [
  DocumentStatus.PARSING,
  DocumentStatus.CHUNKING,
  DocumentStatus.EMBEDDING,
  DocumentStatus.INDEXING,
];

export class ReportProgressDto {
  @IsString()
  documentId!: string;

  @IsString()
  organizationId!: string;

  @IsEnum(DocumentStatus)
  stage!: DocumentStatus;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;
}
