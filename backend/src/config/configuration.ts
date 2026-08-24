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
    /** ACCESS token lifetime. Short by design — sessions live in the DB. */
    tokenTtl: string;
    /** Absolute refresh-session lifetime in days (rotation never extends it). */
    refreshTtlDays: number;
    bcryptRounds: number;
    /** Password-login failure lockout policy (see LoginAttemptsService). */
    lockout: {
      firstThreshold: number;
      firstLockSeconds: number;
      secondThreshold: number;
      secondLockSeconds: number;
      maxLockSeconds: number;
      failureWindowSeconds: number;
      ipWideThreshold: number;
      identityWideThreshold: number;
    };
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
  webIngestion: {
    /**
     * Whether a JS-only page may be rendered in a headless browser as a last
     * resort. Off by default: it needs an optional ~300 MB dependency and it
     * executes third-party JavaScript. Everything else about candidate link
     * ingestion works without it.
     */
    renderEnabled: boolean;
  };
  throttle: {
    ttlMs: number;
    limit: number;
  };
  /**
   * Exchange rates, used to compare a job's salary against what a candidate
   * asked for when the two are quoted in different currencies.
   *
   * Both fields are optional and the product works without them: an
   * unconfigured or unreachable provider means the FX snapshot is UNAVAILABLE,
   * a cross-currency salary reports NOT_COMPARABLE, and the job still ranks
   * and is still shown. Salary is a soft signal; it never gates a job.
   *
   * `baseUrl` is deliberately its own setting rather than a constant baked
   * into the code. An API key does not identify its provider, and hard-coding
   * a guessed endpoint would send a real credential to a service that may not
   * be the one it belongs to.
   */
  /**
   * External job ingestion.
   *
   * Every value is optional and the product works with none of them set: no
   * board tokens means no provider is registered, which means no network call
   * is ever made and the external catalogue simply stays empty.
   *
   * Board tokens are configuration rather than constants because which
   * employers a deployment follows is an operational decision. There is
   * deliberately no credential here — the Greenhouse Job Board API's read path
   * is public, and a key field would only invite pointing this at the private
   * Harvest API, which this product has no business reading.
   */
  externalJobs: {
    /** Comma-separated public Greenhouse board tokens. Empty = disabled. */
    greenhouseBoards: string;
    /** Comma-separated public Lever site slugs. Empty = disabled. */
    leverSites: string;
    /** Postings per Lever request. Bounded in the provider regardless. */
    leverPageSize: number;
    /** Comma-separated public Ashby job-board names. Empty = disabled. */
    ashbyBoards: string;
    /**
     * Approved company careers source IDs, comma-separated — never URLs. The
     * ids select from a catalogue in code that carries each site's access
     * review; an unknown id is dropped. Empty = disabled.
     */
    companyCareersSources: string;
    /**
     * Authorized Ninehire workspaces as `scope:SECRET_ENV_VAR`. The value
     * names an environment variable; it is NEVER the key itself. Empty =
     * disabled, and a source whose variable is unset is dropped rather than
     * scheduled.
     */
    ninehireSources: string;
    ninehirePageSize: number;
    /** Detail calls per sweep. Bounds the 60/minute-per-key budget. */
    ninehireDetailBudget: number;
    /** Whether repeating sweeps are registered at boot. Default false. */
    scheduleEnabled: boolean;
    syncIntervalMs: number;
    /** DB-local lifecycle maintenance cadence. Independent of provider sweeps. */
    revalidateIntervalMs: number;
    requestTimeoutMs: number;
    maxAttempts: number;
  };

  notifications: {
    /** Java Notification Service internal API base URL (BFF reads/marks). */
    serviceUrl: string;
    serviceToken: string;
    timeoutMs: number;
    /** Kafka brokers for the notification outbox + realtime bridge. */
    kafkaBrokers: string;
    kafkaConsumerGroup: string;
    outboxPollMs: number;
    /** Inbound credential for GET /internal/notification-users/{id}. */
    userLookupToken: string;
  };
  entitlements: {
    source: string;
    paymentServiceUrl: string;
    paymentServiceToken: string;
    timeoutMs: number;
    cacheTtlSeconds: number;
    /** Comma-separated Kafka brokers. Empty = entitlement events consumer off. */
    kafkaBrokers: string;
    /** Stable consumer group; changing it replays the topic's retained events. */
    kafkaConsumerGroup: string;
  };
  exchangeRates: {
    /** Provider credential. Never logged, never returned by any endpoint. */
    apiKey: string;
    /**
     * Full request URL template for a latest-rates call. `{key}` and `{base}`
     * are substituted. Empty string = no provider configured.
     */
    baseUrl: string;
    /** Currency the provider's rate table is expressed against. */
    baseCurrency: string;
    refreshIntervalMs: number;
    requestTimeoutMs: number;
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
    // 15 minutes: an access token is a bearer credential that cannot be
    // revoked individually, so its blast radius is capped by its lifetime.
    tokenTtl: process.env.TOKEN_TTL ?? '15m',
    refreshTtlDays: toInt(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
    bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 12),
    lockout: {
      firstThreshold: toInt(process.env.LOGIN_LOCKOUT_FIRST_THRESHOLD, 5),
      firstLockSeconds: toInt(
        process.env.LOGIN_LOCKOUT_FIRST_LOCK_SECONDS,
        900,
      ),
      secondThreshold: toInt(process.env.LOGIN_LOCKOUT_SECOND_THRESHOLD, 3),
      secondLockSeconds: toInt(
        process.env.LOGIN_LOCKOUT_SECOND_LOCK_SECONDS,
        1_800,
      ),
      maxLockSeconds: toInt(process.env.LOGIN_LOCKOUT_MAX_LOCK_SECONDS, 3_600),
      failureWindowSeconds: toInt(
        process.env.LOGIN_LOCKOUT_FAILURE_WINDOW_SECONDS,
        1_800,
      ),
      ipWideThreshold: toInt(process.env.LOGIN_LOCKOUT_IP_WIDE_THRESHOLD, 30),
      identityWideThreshold: toInt(
        process.env.LOGIN_LOCKOUT_IDENTITY_WIDE_THRESHOLD,
        20,
      ),
    },
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
    // 50 MB per document (PDF/DOCX). One knob for every upload path: the
    // Multer interceptors and the service-level validators all read this key.
    maxFileSizeBytes: toInt(process.env.MAX_FILE_SIZE_BYTES, 50 * 1024 * 1024),
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
  webIngestion: {
    renderEnabled: process.env.WEB_RENDER_ENABLED === 'true',
  },
  throttle: {
    ttlMs: toInt(process.env.THROTTLE_TTL_MS, 60_000),
    limit: toInt(process.env.THROTTLE_LIMIT, 120),
  },
  externalJobs: {
    greenhouseBoards: process.env.EXTERNAL_GREENHOUSE_BOARDS ?? '',
    leverSites: process.env.EXTERNAL_LEVER_SITES ?? '',
    leverPageSize: toInt(process.env.EXTERNAL_LEVER_PAGE_SIZE, 100),
    ashbyBoards: process.env.EXTERNAL_ASHBY_BOARDS ?? '',
    companyCareersSources: process.env.EXTERNAL_COMPANY_CAREERS_SOURCES ?? '',
    ninehireSources: process.env.EXTERNAL_NINEHIRE_SOURCES ?? '',
    ninehirePageSize: toInt(process.env.EXTERNAL_NINEHIRE_PAGE_SIZE, 100),
    ninehireDetailBudget: toInt(
      process.env.EXTERNAL_NINEHIRE_DETAIL_BUDGET,
      200,
    ),
    scheduleEnabled: process.env.EXTERNAL_SYNC_ENABLED === 'true',
    syncIntervalMs: toInt(
      process.env.EXTERNAL_SYNC_INTERVAL_MS,
      6 * 60 * 60_000,
    ),
    /*
     * Bounds enforced here because a scheduler consumes whatever it is given:
     * a typo'd 3600 (seconds, not ms) would otherwise poll the database
     * every 3.6 seconds forever, and 0 would be a hot loop. The pass is
     * DB-local — it never calls providers — so the floor is about the
     * database, not about third parties.
     */
    revalidateIntervalMs: Math.min(
      24 * 60 * 60_000,
      Math.max(
        5 * 60_000,
        toInt(process.env.EXTERNAL_REVALIDATE_INTERVAL_MS, 60 * 60_000),
      ),
    ),
    requestTimeoutMs: toInt(process.env.EXTERNAL_REQUEST_TIMEOUT_MS, 20_000),
    maxAttempts: toInt(process.env.EXTERNAL_MAX_ATTEMPTS, 3),
  },
  notifications: {
    serviceUrl: process.env.NOTIFICATION_SERVICE_URL ?? '',
    serviceToken: process.env.NOTIFICATION_SERVICE_INTERNAL_TOKEN ?? '',
    timeoutMs: toInt(process.env.NOTIFICATION_SERVICE_TIMEOUT_MS, 2_500),
    /** Falls back to the entitlement brokers — one local broker serves both. */
    kafkaBrokers:
      process.env.NOTIFICATIONS_KAFKA_BROKERS ??
      process.env.ENTITLEMENTS_KAFKA_BROKERS ??
      '',
    kafkaConsumerGroup:
      process.env.NOTIFICATIONS_KAFKA_CONSUMER_GROUP ??
      'hr-copilot-backend.notification-bridge',
    outboxPollMs: toInt(process.env.NOTIFICATIONS_OUTBOX_POLL_MS, 500),
    userLookupToken: process.env.NOTIFICATION_USER_LOOKUP_TOKEN ?? '',
  },
  entitlements: {
    /** 'db' (transitional column) or 'payment-service' (billing authority). */
    source: process.env.ENTITLEMENTS_SOURCE ?? 'db',
    paymentServiceUrl: process.env.PAYMENT_SERVICE_URL ?? '',
    paymentServiceToken: process.env.PAYMENT_SERVICE_INTERNAL_TOKEN ?? '',
    timeoutMs: toInt(process.env.PAYMENT_SERVICE_TIMEOUT_MS, 2_500),
    /** Clamped to at most 300s by the source — stale authorization stays short. */
    cacheTtlSeconds: toInt(process.env.ENTITLEMENTS_CACHE_TTL_SECONDS, 120),
    kafkaBrokers: process.env.ENTITLEMENTS_KAFKA_BROKERS ?? '',
    kafkaConsumerGroup:
      process.env.ENTITLEMENTS_KAFKA_CONSUMER_GROUP ??
      'hr-copilot-backend.entitlements',
  },
  exchangeRates: {
    apiKey: process.env.EXCHANGE_RATE_API_KEY ?? '',
    baseUrl: process.env.EXCHANGE_RATE_API_URL ?? '',
    baseCurrency: process.env.EXCHANGE_RATE_BASE_CURRENCY ?? 'USD',
    refreshIntervalMs: toInt(process.env.EXCHANGE_RATE_REFRESH_MS, 30 * 60_000),
    requestTimeoutMs: toInt(process.env.EXCHANGE_RATE_TIMEOUT_MS, 10_000),
  },
});
