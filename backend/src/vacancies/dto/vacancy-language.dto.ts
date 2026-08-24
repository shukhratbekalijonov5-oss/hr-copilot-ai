import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { LanguageProficiency } from '../../generated/prisma/enums';
import { LANGUAGE_CODE_PATTERN } from '../../common/vacancy/job-vocabulary';

/**
 * One language the role needs, at one level.
 *
 * The code is a BCP-47 primary subtag and is NOT limited to the product's four
 * UI locales — the interface language and the job's language are different
 * questions.
 */
export class VacancyLanguageRequirementDto {
  @IsString()
  @Matches(LANGUAGE_CODE_PATTERN, {
    message:
      'languageCode must be a lowercase BCP-47 primary subtag, e.g. "ko" or "en"',
  })
  languageCode!: string;

  @IsEnum(LanguageProficiency)
  level!: LanguageProficiency;

  /** Defaults to a MUST-have, matching JobRequirement.required. */
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}
