import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * An HR user's evidence search.
 *
 * There is deliberately no organizationId field. The tenant is derived from
 * the authenticated user's JWT, and the global ValidationPipe runs with
 * forbidNonWhitelisted, so a client that tries to send one gets a 400 rather
 * than having it silently ignored.
 */
export class EvidenceSearchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  query!: string;

  /** Optional narrowing, still inside the caller's own organization. */
  @IsOptional() @IsUUID() candidateId?: string;
  @IsOptional() @IsUUID() documentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Second-stage cross-encoder reranking. On by default. */
  @IsOptional()
  @IsBoolean()
  rerank?: boolean;
}
