import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../../ai/ai-service.client';

/**
 * Options for the caller's OWN job matching. There is deliberately no
 * candidateAccountId and no organizationId: the subject is always the
 * authenticated user's own candidate account.
 *
 * `page`/`limit` are TRANSPORT, not search. Every eligible vacancy is ranked
 * before any page is cut, and a page is a slice of that finished ranking — so
 * asking for page 3 returns results 41-60 of the same list, never a fresh
 * search with a different order. `limit` used to be "how many matches to
 * return after retrieval", which is precisely what made a candidate's results
 * a top-5 of an arbitrary 30.
 */
export class JobMatchesDto {
  /** Defaults to the user's preferredLocale. */
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES, {
    message: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  })
  locale?: SupportedLocale;

  /** 1-based page of the ranked list. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * Page size. Capped at 50 so one response stays a reasonable payload — this
   * bounds the PAGE, never the ranking, and `total` always reports the full
   * ranked count so a client can page to the end.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /**
   * Force a fresh ranking even if the stored one is still current.
   *
   * The candidate's explicit "Refresh matches". Ordinary paging must NOT set
   * it: recomputing per page would reshuffle the list under the reader.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  refresh?: boolean;
}
