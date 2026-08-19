import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 moved the Migrate/Introspect connection URL out of schema.prisma
 * and into this file. The runtime PrismaClient does NOT read it — it receives a
 * driver adapter built from ConfigService (see src/prisma/prisma.service.ts).
 *
 * DATABASE_URL is read from the environment; it is never hardcoded or logged.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
