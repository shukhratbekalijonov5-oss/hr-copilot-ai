import { IsIn, IsOptional } from 'class-validator';
import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../../ai/ai-service.client';

/**
 * Locale for AI-generated text.
 *
 * Validated against the supported list rather than accepted as free text: an
 * unsupported code would silently produce an English answer for a user who
 * asked for something else.
 */
export class LocaleDto {
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES, {
    message: `locale must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  })
  locale?: SupportedLocale;
}

/**
 * Runs a JD -> evidence mapping.
 *
 * There is deliberately no organizationId, candidateId or vacancyId field:
 * candidate and vacancy come from the route path and the organization from the
 * authenticated user.
 */
export class RunEvidenceMapDto extends LocaleDto {}
