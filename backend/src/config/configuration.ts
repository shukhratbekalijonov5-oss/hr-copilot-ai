/**
 * Typed application configuration.
 *
 * Everything the backend needs is read from the environment exactly once, here.
 * No module reads `process.env` directly (`main.ts` is the single bootstrap
 * exception, and only to decide whether config validation itself may run).
 *
 * Nothing in this file may be logged: several fields are secrets.
 */

export type StorageDriver = 'local' | 'r2';

export interface AppConfiguration {
  app: {
    nodeEnv: string;
    port: number;
    frontendUrl: string;
    globalPrefix: string;
  };
  auth: {
    /** Backend auth signing secret. The project standardises on SECRET_TOKEN. */
    secretToken: string;
    tokenTtl: string;
    bcryptRounds: number;
  };
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  storage: {
    driver: StorageDriver;
    /** Filesystem root used by the `local` driver only. */
    localRoot: string;
    maxFileSizeBytes: number;
    signedUrlTtlSeconds: number;
    r2: {
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucket: string;
    };
  };
  ai: {
    /** Empty string => the Python AI service is not wired up yet. */
    baseUrl: string;
    /**
     * Shared credential for backend->AI calls. Deliberately separate from
     * SECRET_TOKEN: a user session secret must not double as a service one.
     */
    internalToken: string;
    timeoutMs: number;
  };
  throttle: {
    ttlMs: number;
    limit: number;
  };
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default (): AppConfiguration => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    // Frontend owns 3000 locally; the backend defaults to 3001.
    port: toInt(process.env.PORT, 3001),
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    globalPrefix: process.env.API_PREFIX ?? 'api',
  },
  auth: {
    secretToken: process.env.SECRET_TOKEN ?? '',
    tokenTtl: process.env.TOKEN_TTL ?? '1d',
    bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 12),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  storage: {
    driver: (process.env.STORAGE_DRIVER as StorageDriver) ?? 'local',
    localRoot: process.env.STORAGE_LOCAL_ROOT ?? './storage',
    maxFileSizeBytes: toInt(process.env.MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024),
    signedUrlTtlSeconds: toInt(process.env.SIGNED_URL_TTL_SECONDS, 900),
    r2: {
      accountId: process.env.R2_ACCOUNT_ID ?? '',
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      bucket: process.env.R2_BUCKET ?? '',
    },
  },
  ai: {
    baseUrl: process.env.AI_SERVICE_URL ?? '',
    internalToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    // Embedding a long resume is slower than a typical HTTP call; the queue
    // worker is the caller, so a generous ceiling is fine.
    timeoutMs: toInt(process.env.AI_SERVICE_TIMEOUT_MS, 120_000),
  },
  throttle: {
    ttlMs: toInt(process.env.THROTTLE_TTL_MS, 60_000),
    limit: toInt(process.env.THROTTLE_LIMIT, 120),
  },
});
