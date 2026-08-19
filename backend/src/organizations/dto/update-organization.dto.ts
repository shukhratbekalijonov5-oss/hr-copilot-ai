import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Only the display name is editable.
 *
 * `slug` is intentionally immutable: it is a stable public identifier that may
 * already appear in links and invitations. `id` is never accepted from a
 * client — the organization being updated always comes from the JWT.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;
}
