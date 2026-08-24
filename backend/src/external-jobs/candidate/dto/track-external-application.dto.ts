import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  EXTERNAL_APPLICATION_STATUSES,
  MAX_TRACKING_NOTE_LENGTH,
} from '../external-application.policy';
import type { ExternalApplicationStatus } from '../../../generated/prisma/enums';

/**
 * "I applied to this job" — the candidate's own words, bounded.
 *
 * Everything here is SELF-REPORTED. There is no field a provider, a crawler
 * or a link click could fill in, because none of them knows whether an
 * application was actually submitted on the employer's site.
 */
export class TrackExternalApplicationDto {
  /** Defaults to APPLIED — the reason this record exists. */
  @IsOptional()
  @IsIn(EXTERNAL_APPLICATION_STATUSES)
  status?: ExternalApplicationStatus;

  /**
   * When the candidate says they applied. Defaults to now. The service
   * refuses future values — "I will apply tomorrow" is not a record of an
   * application.
   */
  @IsOptional()
  @IsISO8601()
  appliedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TRACKING_NOTE_LENGTH)
  note?: string;
}

/**
 * Any subset of the tracker, corrected by its owner.
 *
 * `note: null` explicitly clears the note — distinct from omitting it, which
 * leaves it alone. `ValidateIf` lets the null through the string validators.
 */
export class UpdateExternalApplicationDto {
  @IsOptional()
  @IsIn(EXTERNAL_APPLICATION_STATUSES)
  status?: ExternalApplicationStatus;

  @IsOptional()
  @IsISO8601()
  appliedAt?: string;

  @ValidateIf((dto: UpdateExternalApplicationDto) => dto.note !== null)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TRACKING_NOTE_LENGTH)
  note?: string | null;
}
