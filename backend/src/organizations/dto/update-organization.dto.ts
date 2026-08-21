import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * The organization's display name and public web address.
 *
 * `slug` stays intentionally immutable: it is a stable public identifier that
 * may already appear in links and invitations. `id` is never accepted from a
 * client — the organization being updated always comes from the JWT.
 *
 * `websiteUrl` is OPTIONAL, as the schema has it: an organization with no site
 * is valid, so an empty string is accepted and stored as null (that is how the
 * field is cleared) while a non-empty value must be a real http(s) URL. It is
 * only ever displayed — nothing fetches it — so it carries none of the SSRF
 * surface a candidate-supplied link does.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'Enter a valid URL starting with http:// or https://' },
  )
  websiteUrl?: string | null;
}
