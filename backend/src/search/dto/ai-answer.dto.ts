import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../../ai/ai-service.client';

/**
 * A grounded question about a candidate's documents.
 *
 * No organizationId field — the tenant comes from the JWT, and the global
 * ValidationPipe rejects unknown properties.
 */
export class AiAnswerDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  query!: string;

  @IsOptional() @IsUUID() candidateId?: string;
  @IsOptional() @IsUUID() vacancyId?: string;

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES, {
    message: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  })
  locale?: SupportedLocale;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class CandidateSummaryDto {
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES, {
    message: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  })
  locale?: SupportedLocale;
}

export class InterviewQuestionsDto extends CandidateSummaryDto {}
