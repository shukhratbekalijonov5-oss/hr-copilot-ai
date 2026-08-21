import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Create/replace payload for one professional link.
 *
 * The URL is validated here only for shape and length. Everything that
 * actually matters — scheme, port, credentials, host policy, normalization,
 * duplicate identity — is decided by src/web-ingestion/url-policy.ts, which is
 * the single authority the fetcher also uses. A second, looser opinion in a
 * DTO would be a way for the two to disagree.
 */
export class UpsertCandidateLinkDto {
  @IsString()
  @MinLength(4)
  @MaxLength(2048)
  url!: string;

  /**
   * The candidate's own label for the source ("My portfolio"). Optional: with
   * none, the page's <title> is used, and failing that the hostname. A label
   * is a display convenience and is NEVER treated as a claim about who owns
   * the site.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
