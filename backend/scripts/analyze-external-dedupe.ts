/**
 * What the deterministic dedupe actually did, across providers.
 *
 *   npm run external:dedupe-report
 *
 * Read-only. It exists because "cross-provider dedupe works" is a claim that
 * can only be checked against real data, and because the honest answer is
 * often ZERO: two ATSs rarely carry the same requisition, and a report that
 * could only ever say "merged!" would be measuring its own optimism.
 *
 * So this counts what happened, names the evidence for every merge it finds,
 * and separately counts the pairs that LOOKED mergeable and were deliberately
 * kept apart — because those are the false merges that did not happen, and
 * they are the number worth watching.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const logger = new Logger('DedupeReport');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);

  try {
    // -- What is in the catalogue at all ------------------------------------
    const byProvider = await prisma.externalJobSource.groupBy({
      by: ['provider'],
      _count: true,
    });
    logger.log(
      `sources: ${byProvider
        .map((row) => `${row.provider}=${row._count}`)
        .join(' ')}`,
    );

    const byConfidence = await prisma.externalJobSource.groupBy({
      by: ['provider', 'mergeConfidence'],
      _count: true,
    });
    for (const row of byConfidence) {
      logger.log(
        `  ${row.provider} ${row.mergeConfidence}: ${row._count} source(s)`,
      );
    }

    // -- Actual cross-provider merges ---------------------------------------
    // A canonical job carrying sources from more than one provider is the
    // thing this whole architecture is for.
    const merged = await prisma.$queryRaw<
      { id: string; providers: string; n: number }[]
    >`
      SELECT j.id,
             string_agg(DISTINCT s.provider::text, '+') AS providers,
             count(DISTINCT s.provider)::int AS n
      FROM external_jobs j
      JOIN external_job_sources s ON s."externalJobId" = j.id
      GROUP BY j.id
      HAVING count(DISTINCT s.provider) > 1`;

    logger.log(`CROSS-PROVIDER MERGES: ${merged.length}`);
    for (const row of merged.slice(0, 20)) {
      const job = await prisma.externalJob.findUnique({
        where: { id: row.id },
        select: {
          title: true,
          city: true,
          countryCode: true,
          canonicalUrl: true,
          company: { select: { name: true } },
          sources: {
            select: {
              provider: true,
              sourceKey: true,
              mergeConfidence: true,
              mergeReason: true,
            },
          },
        },
      });
      if (!job) continue;
      logger.log(
        `  MERGED ${job.company.name} | ${job.title.trim()} | ` +
          `${[job.city, job.countryCode].filter(Boolean).join(', ') || 'location unstated'}`,
      );
      for (const source of job.sources) {
        logger.log(
          `    ${source.provider}/${source.sourceKey} ` +
            `${source.mergeConfidence}: ${source.mergeReason ?? 'first source'}`,
        );
      }
    }

    // -- Pairs that were deliberately NOT merged ----------------------------
    /*
     * The disambiguation path: the fingerprint matched an existing job but the
     * merge could not be justified, so a second row was stored instead. These
     * are the false merges that did not happen.
     */
    const possible = await prisma.externalJobSource.findMany({
      where: { mergeConfidence: 'POSSIBLE' },
      select: {
        provider: true,
        sourceKey: true,
        mergeReason: true,
        job: {
          select: {
            title: true,
            normalizedTitle: true,
            city: true,
            company: { select: { name: true } },
          },
        },
      },
    });
    logger.log(`KEPT SEPARATE (POSSIBLE): ${possible.length}`);
    const reasons = new Map<string, number>();
    for (const row of possible) {
      const reason = row.mergeReason ?? 'unrecorded';
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    for (const [reason, count] of reasons) {
      logger.log(`  ${count}x ${reason}`);
    }
    for (const row of possible.slice(0, 8)) {
      logger.log(
        `    ${row.provider}/${row.sourceKey} — ${row.job.company.name} | ` +
          `${row.job.title.trim()} | ${row.job.city ?? 'no city'}`,
      );
    }

    // -- Overlap that COULD have produced a merge ---------------------------
    // Reported whether or not anything merged, so a zero is legible: it says
    // "no overlap existed", not "the dedupe found nothing".
    const companyOverlap = await prisma.$queryRaw<
      { normalizedname: string; providers: string }[]
    >`
      SELECT c."normalizedName" AS normalizedname,
             string_agg(DISTINCT s.provider::text, '+') AS providers
      FROM external_companies c
      JOIN external_jobs j ON j."externalCompanyId" = c.id
      JOIN external_job_sources s ON s."externalJobId" = j.id
      GROUP BY c."normalizedName"
      HAVING count(DISTINCT s.provider) > 1`;
    logger.log(`SAME-COMPANY ACROSS PROVIDERS: ${companyOverlap.length}`);
    for (const row of companyOverlap.slice(0, 10)) {
      logger.log(`  ${row.normalizedname} seen via ${row.providers}`);
    }

    const titleOverlap = await prisma.$queryRaw<
      { normalizedtitle: string; providers: string; n: number }[]
    >`
      SELECT j."normalizedTitle" AS normalizedtitle,
             string_agg(DISTINCT s.provider::text, '+') AS providers,
             count(*)::int AS n
      FROM external_jobs j
      JOIN external_job_sources s ON s."externalJobId" = j.id
      GROUP BY j."normalizedTitle"
      HAVING count(DISTINCT s.provider) > 1
      ORDER BY n DESC`;
    logger.log(`SAME-TITLE ACROSS PROVIDERS: ${titleOverlap.length}`);
    for (const row of titleOverlap.slice(0, 10)) {
      logger.log(
        `  "${row.normalizedtitle}" — ${row.n} job(s) via ${row.providers}`,
      );
    }

    /*
     * The important negative result: titles that match across providers at
     * DIFFERENT companies. Every one of these is a pair a title-based dedupe
     * would have merged, and every one would have been wrong.
     */
    const crossCompanyTitles = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (
        SELECT j."normalizedTitle"
        FROM external_jobs j
        JOIN external_job_sources s ON s."externalJobId" = j.id
        GROUP BY j."normalizedTitle"
        HAVING count(DISTINCT s.provider) > 1
           AND count(DISTINCT j."externalCompanyId") > 1
      ) t`;
    logger.log(
      `FALSE MERGES A TITLE-ONLY RULE WOULD HAVE MADE: ` +
        `${crossCompanyTitles[0].n} title group(s) spanning several companies`,
    );

    // -- Same-provider protection, measured --------------------------------
    const sameProviderKept = possible.filter((row) =>
      /different job id/i.test(row.mergeReason ?? ''),
    ).length;
    logger.log(
      `SAME-PROVIDER DISTINCT REQUISITIONS PROTECTED: ${sameProviderKept}`,
    );

    logger.log('EXTERNAL DEDUPE REPORT: COMPLETE');
  } finally {
    await app.close();
  }
}

void main().then(
  () => process.exit(0),
  (error: Error) => {
    new Logger('DedupeReport').error(error.message);
    process.exit(1);
  },
);
