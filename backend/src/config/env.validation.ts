import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export enum StorageDriverEnum {
  Local = 'local',
  R2 = 'r2',
}

/**
 * Shape of the raw environment. Validation runs at boot so the process fails
 * fast and loudly on misconfiguration — but error messages report *names*
 * only, never values, so secrets never reach the logs.
 */
export class EnvironmentVariables {
  @IsOptional()
  @IsEnum(NodeEnv)
  NODE_ENV?: NodeEnv;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT?: number;

  @IsOptional()
  @IsString()
  FRONTEND_URL?: string;

  @IsNotEmpty({ message: 'DATABASE_URL is required' })
  @IsString()
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @MinLength(32, {
    message: 'SECRET_TOKEN must be at least 32 characters long',
  })
  SECRET_TOKEN!: string;

  @IsOptional()
  @IsString()
  TOKEN_TTL?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  REFRESH_TOKEN_TTL_DAYS?: number;

  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(15)
  BCRYPT_ROUNDS?: number;

  @IsOptional()
  @IsEnum(StorageDriverEnum)
  STORAGE_DRIVER?: StorageDriverEnum;

  @IsOptional()
  @IsString()
  STORAGE_LOCAL_ROOT?: string;

  @IsOptional()
  @IsString()
  R2_ACCOUNT_ID?: string;

  @IsOptional()
  @IsString()
  R2_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  R2_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  R2_BUCKET?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'AI_SERVICE_URL must be a URL' })
  AI_SERVICE_URL?: string;

  @IsOptional()
  @IsString()
  INTERNAL_SERVICE_TOKEN?: string;

  /**
   * Opt-in headless rendering for JavaScript-only portfolio pages. Off unless
   * a deployment has actually installed Playwright and its browser — see
   * src/web-ingestion/renderer.ts for why this is a switch and not a
   * dependency.
   */
  @IsOptional()
  @IsBoolean()
  WEB_RENDER_ENABLED?: boolean;

  /**
   * Exchange-rate provider credentials. BOTH are optional and the backend runs
   * without them: with no provider configured the FX snapshot is simply
   * UNAVAILABLE, cross-currency salary comparison reports NOT_COMPARABLE, and
   * every job stays eligible and ranked. FX is an enrichment, never a gate.
   *
   * The URL is separate from the key on purpose. A key alone does not identify
   * a provider, and guessing an endpoint would mean sending someone's
   * credential to a service that may not be theirs.
   */
  @IsOptional()
  @IsString()
  EXCHANGE_RATE_API_KEY?: string;

  @IsOptional()
  @IsString()
  EXCHANGE_RATE_API_URL?: string;
}

/** Fields that must be present and non-empty when STORAGE_DRIVER=r2. */
const R2_REQUIRED_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const;

export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  // AI_SERVICE_URL is legitimately empty while the Python service does not
  // exist yet; an empty string would otherwise trip @IsUrl.
  const normalised = { ...raw };
  if (normalised.AI_SERVICE_URL === '') delete normalised.AI_SERVICE_URL;
  if (normalised.EXCHANGE_RATE_API_URL === '') {
    delete normalised.EXCHANGE_RATE_API_URL;
  }

  const parsed = plainToInstance(EnvironmentVariables, normalised, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(parsed, { skipMissingProperties: false });

  if (errors.length > 0) {
    // Report constraint messages and property names only — never the values.
    const details = errors
      .map((e) =>
        Object.values(e.constraints ?? { unknown: e.property }).join('; '),
      )
      .join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  // A configured AI service with no service credential would be rejected by
  // every /internal/* call; fail at boot instead of once per job.
  const internalToken = raw.INTERNAL_SERVICE_TOKEN;
  const hasInternalToken =
    typeof internalToken === 'string' && internalToken.trim().length > 0;
  if (raw.AI_SERVICE_URL && !hasInternalToken) {
    throw new Error(
      'Invalid environment configuration:\n  - AI_SERVICE_URL is set but ' +
        'INTERNAL_SERVICE_TOKEN is empty',
    );
  }

  if (parsed.STORAGE_DRIVER === StorageDriverEnum.R2) {
    const missing = R2_REQUIRED_KEYS.filter((key) => !raw[key]);
    if (missing.length > 0) {
      throw new Error(
        `Invalid environment configuration:\n  - STORAGE_DRIVER=r2 requires ${missing.join(', ')}`,
      );
    }
  }

  return raw;
}
