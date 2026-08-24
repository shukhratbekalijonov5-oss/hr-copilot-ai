/**
 * Bring the semantic index up to date with the catalogue.
 *
 *   npm run external:index
 *
 * The same bounded pass the BullMQ job runs, repeated until nothing is
 * pending. On demand as well as scheduled, because the first thing anyone
 * needs after enabling semantic retrieval is to index what is already there
 * and see how long it took.
 *
 * Safe to interrupt and safe to re-run: each pass stamps only the jobs it
 * actually indexed, so a kill mid-way costs duplicate work on the next run and
 * nothing else. Nothing here deletes a job, changes a status, or touches a
 * provider.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ExternalIndexService } from '../src/external-jobs/search/external-index.service';

async function main(): Promise<void> {
  const logger = new Logger('ExternalIndex');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const index = app.get(ExternalIndexService);
    const started = Date.now();

    const pendingBefore = await index.pendingCount();
    logger.log(`${pendingBefore} job(s) waiting to be indexed`);

    let indexed = 0;
    let removed = 0;
    // Bounded: a runaway loop against a service that keeps returning "pending"
    // would be worse than an incomplete index.
    for (let pass = 0; pass < 200; pass += 1) {
      const outcome = await index.indexPending();
      if (outcome.skipped) {
        logger.warn(
          'The AI service is not configured; the catalogue stays searchable ' +
            'through the lexical index only',
        );
        break;
      }
      indexed += outcome.indexed;
      removed += outcome.removed;
      if (outcome.indexed === 0 && outcome.removed === 0) break;
      logger.log(
        `pass ${pass + 1}: +${outcome.indexed} indexed, -${outcome.removed} ` +
          `removed, ${outcome.pending} pending`,
      );
    }

    const pendingAfter = await index.pendingCount();
    const seconds = (Date.now() - started) / 1000;
    logger.log(
      `EXTERNAL INDEX: ${indexed} indexed, ${removed} removed, ` +
        `${pendingAfter} still pending in ${seconds.toFixed(1)}s ` +
        `(${indexed > 0 ? (indexed / seconds).toFixed(1) : '0'} jobs/s)`,
    );
  } finally {
    await app.close();
  }
}

void main().then(
  () => process.exit(0),
  (error: Error) => {
    new Logger('ExternalIndex').error(error.message);
    process.exit(1);
  },
);
