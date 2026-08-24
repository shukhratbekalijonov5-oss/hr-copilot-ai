/**
 * Run one external provider sweep, on demand.
 *
 *   npm run external:sync -- GREENHOUSE
 *
 * On-demand rather than only-scheduled, because the first thing anyone needs
 * from a new provider is to run it once and look at what came back. It boots
 * the application context — the same registry, the same provider, the same
 * ingestion path a queued job uses — so what this proves is what production
 * does, not a parallel implementation of it.
 *
 * It opens no HTTP surface. An admin endpoint that triggers third-party
 * fetches is a denial-of-service lever pointed at someone else's API, and it
 * would need authentication, rate limiting and an audit trail to be worth
 * having. A script needs shell access, which is already the boundary.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ExternalSyncService } from '../src/external-jobs/external-sync.service';
import { ExternalProviderRegistry } from '../src/external-jobs/provider-registry';
import type { ExternalProvider } from '../src/generated/prisma/enums';

async function main(): Promise<void> {
  const logger = new Logger('ExternalSync');
  const requested = (process.argv[2] ?? '').toUpperCase();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const registry = app.get(ExternalProviderRegistry);
    const sync = app.get(ExternalSyncService);

    const runnable = registry.list().map((provider) => provider.descriptor.provider);
    if (runnable.length === 0) {
      logger.warn(
        'No external provider is configured. Set EXTERNAL_GREENHOUSE_BOARDS ' +
          'to a comma-separated list of public board tokens.',
      );
      return;
    }

    const targets: ExternalProvider[] = requested
      ? runnable.filter((name) => name === requested)
      : runnable;

    if (targets.length === 0) {
      logger.warn(
        `Provider ${requested} is not registered. Runnable: ${runnable.join(', ')}`,
      );
      return;
    }

    for (const provider of targets) {
      const outcome = await sync.syncProvider(provider);
      if (!outcome) continue;
      // Printed as one line of counters. No posting content, no URLs.
      logger.log(
        `${outcome.provider} ${outcome.status} run=${outcome.runId} ` +
          `scopes=${outcome.scopes.join('|')} fetched=${outcome.fetched} ` +
          `created=${outcome.created} updated=${outcome.updated} ` +
          `merged=${outcome.merged} unmerged=${outcome.unmerged} ` +
          `closed=${outcome.closed} failed=${outcome.failed} ` +
          `${outcome.durationMs}ms`,
      );
    }
  } finally {
    await app.close();
  }
}

void main().then(
  () => process.exit(0),
  (error: Error) => {
    new Logger('ExternalSync').error(error.message);
    process.exit(1);
  },
);
