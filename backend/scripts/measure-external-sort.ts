/**
 * How long the two orders take, against the real catalogue.
 *
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' \
 *     scripts/measure-external-sort.ts
 *
 * Local numbers on one developer machine, reported as measurements rather than
 * as any kind of service level. Each search is run against a FRESH candidate
 * account so no measurement is a cache read — the interesting cost is
 * computing a ranking, and a stored snapshot answers in milliseconds by
 * design.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExternalSearchService } from '../src/external-jobs/search/external-search.service';
import type { ExternalJobSearchDto } from '../src/external-jobs/search/dto/external-job-search.dto';

const RUN = Date.now().toString(36);

async function main(): Promise<void> {
  const logger = new Logger('MeasureExternalSort');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const search = app.get(ExternalSearchService);

  const cases: { label: string; dto: ExternalJobSearchDto }[] = [
    {
      label: 'relevance, query',
      dto: { query: 'Backend Engineer', pageSize: 20 },
    },
    {
      label: 'newest, query',
      dto: { query: 'Backend Engineer', sort: 'NEWEST', pageSize: 20 },
    },
    { label: 'newest, no query', dto: { sort: 'NEWEST', pageSize: 20 } },
    {
      label: 'newest, country',
      dto: {
        query: 'Backend Engineer',
        countries: ['CA'],
        sort: 'NEWEST',
        pageSize: 20,
      },
    },
    { label: 'relevance, no query', dto: { pageSize: 20 } },
  ];

  const users: string[] = [];
  try {
    for (const [index, testCase] of cases.entries()) {
      // A new account each time: same fingerprint inputs, different owner, so
      // every run computes rather than reading a neighbour's snapshot.
      const user = await prisma.user.create({
        data: {
          email: `measure-${RUN}-${index}@example.invalid`,
          fullName: 'Sort Measurement',
          passwordHash: 'x',
          accountType: 'CANDIDATE',
          candidateAccount: { create: {} },
        },
        select: { id: true },
      });
      users.push(user.id);

      const started = Date.now();
      const page = await search.search(user.id, testCase.dto);
      const cold = Date.now() - started;

      const cachedStart = Date.now();
      await search.search(user.id, testCase.dto);
      const cached = Date.now() - cachedStart;

      logger.log(
        `${testCase.label.padEnd(22)} cold=${String(cold).padStart(5)}ms ` +
          `cached=${String(cached).padStart(4)}ms  matched=${page.matched} ` +
          `ranked=${page.ranked} truncated=${page.truncated} ` +
          `degraded=${page.degraded}`,
      );
    }
  } finally {
    for (const id of users) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
