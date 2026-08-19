import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The opaque refresh credential (`<sessionId>.<secret>`). Sent in the body —
 * never in a URL, where it would land in access logs. Length bounds are a
 * cheap pre-filter; real validation happens against the stored hash.
 */
export class RefreshDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  refreshToken!: string;
}
