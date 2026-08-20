import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../../ai/ai-service.client';

/**
 * Options for the caller's OWN job matching. There is deliberately no
 * candidateAccountId and no organizationId: the subject is always the
 * authenticated user's own candidate account.
 */
export class JobMatchesDto {
  /** Defaults to the user's preferredLocale. */
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES, {
    message: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  })
  locale?: SupportedLocale;

  /** How many matches to return (top-N after retrieval + reranking). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}
