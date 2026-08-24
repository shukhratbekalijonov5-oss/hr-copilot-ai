import { IsIn, IsOptional } from 'class-validator';
import { SUPPORTED_LOCALES } from '../../../ai/ai-service.client';
import type { SupportedLocale } from '../../../ai/ai-service.client';

/**
 * The only input the premium generation endpoints take: which language to
 * answer in. Shared by Cover Letter and Interview Prep (why-match keeps its
 * original, identical `WhyMatchDto` — same contract, kept name).
 *
 * Optional — omitted means "use the account's own preferred locale",
 * resolved server-side. There is deliberately nothing else here: the
 * candidate is the authenticated caller, the job is the path parameter, and
 * every fact used for grounding is read from the database. A field a client
 * could send is a field a client could use to steer the answer away from the
 * stored truth.
 */
export class PremiumAiLocaleDto {
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES)
  locale?: SupportedLocale;
}
