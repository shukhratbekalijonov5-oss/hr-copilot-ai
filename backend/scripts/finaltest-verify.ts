/**
 * Read-only verification of the final-test dataset.
 *
 * Drives the SAME services the HR controllers call
 * (`VacanciesService.listVacancyCandidates`, `CompareService`,
 * `CandidatesService`), with each vacancy's real owner userId — so the
 * creator-scoped authorization, the applicant predicate and the de-duplication
 * are all exercised exactly as a browser request would exercise them.
 *
 * It exists because the two target vacancies live in DIFFERENT organizations
 * with different owners, and one of those owners is a personal account whose
 * password is not part of the fixture set. Rather than forge a session, this
 * calls the layer directly beneath the HTTP boundary.
 *
 * Writes nothing. Safe to run at any time.
 *
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/finaltest-verify.ts
 */
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { VacanciesService } from '../src/vacancies/vacancies.service';
import { CandidatesService } from '../src/candidates/candidates.service';

const logger = new Logger('FinalTestVerify');

const TARGETS = [
  { title: 'Frontend Engineer', id: '111acad3-15d9-4017-a748-187370f23c91' },
  {
    title: 'Middle Backend Engineer',
    id: '3475dbc9-da8a-4a8e-a386-afe7aa2a29cb',
  },
];

interface CandidateRow {
  candidate: {
    id: string;
    fullName: string;
    email: string;
    documentCount: number;
  };
  application: { id: string; status: string };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const vacancies = app.get(VacanciesService);
  const candidates = app.get(CandidatesService);

  try {
    for (const target of TARGETS) {
      const vacancy = await prisma.vacancy.findUniqueOrThrow({
        where: { id: target.id },
        select: {
          id: true,
          title: true,
          organizationId: true,
          createdBy: { select: { id: true, email: true } },
        },
      });

      // The owner's own view — the exact call the HR page makes.
      const page = (await vacancies.listVacancyCandidates(
        vacancy.organizationId,
        vacancy.createdBy.id,
        vacancy.id,
        { page: 1, limit: 100, skip: 0 },
      )) as { data: CandidateRow[]; meta: { total: number } };

      const ids = page.data.map((row) => row.candidate.id);
      const emails = page.data.map((row) => row.candidate.email);
      const batch = emails.filter((e) => e.startsWith('finaltest.'));

      logger.log(`\n=== ${vacancy.title} ===`);
      logger.log(`  owner: ${vacancy.createdBy.email}`);
      logger.log(
        `  rows: ${page.data.length} | meta.total: ${page.meta.total}`,
      );
      logger.log(
        `  unique candidate ids: ${new Set(ids).size} (duplicates: ${ids.length - new Set(ids).size})`,
      );
      logger.log(
        `  unique emails: ${new Set(emails).size} | unique names: ${new Set(page.data.map((r) => r.candidate.fullName)).size}`,
      );
      logger.log(
        `  batch members: ${batch.length} | pre-existing preserved: ${emails.length - batch.length}`,
      );
      logger.log(
        `  every row has >=1 document: ${page.data.every((r) => r.candidate.documentCount >= 1)}`,
      );

      // Application ROWS vs unique PEOPLE — the distinction that matters.
      const rows = await prisma.application.count({
        where: {
          vacancyId: vacancy.id,
          source: 'DIRECT',
          candidate: { candidateAccountId: { not: null } },
        },
      });
      logger.log(`  application rows: ${rows} (people: ${new Set(ids).size})`);

      // A representative candidate resolves through Candidate Detail.
      const sample = page.data[0];
      const detail = (await candidates.findOne(
        vacancy.organizationId,
        sample.candidate.id,
      )) as unknown as {
        fullName: string;
        documentCount: number;
        applications: unknown[];
      };
      logger.log(
        `  sample detail (${detail.fullName}): ${detail.documentCount} current document(s), ` +
          `${detail.applications.length} application(s)`,
      );

      // The protected file flow, for one applicant of THIS vacancy: the same
      // owned-vacancy + applicant chain, then a signed URL that is fetched to
      // prove it actually serves the bytes.
      const evidence = (await candidates.getCurrentEvidence(
        vacancy.createdBy.id,
        vacancy.organizationId,
        sample.candidate.id,
        vacancy.id,
      )) as { documents: { id: string; fileName: string }[] };
      const first = evidence.documents[0];
      if (first) {
        const signed = (await candidates.getCurrentDocumentDownload(
          vacancy.createdBy.id,
          vacancy.organizationId,
          sample.candidate.id,
          vacancy.id,
          first.id,
        )) as { url: string; originalFileName: string };
        const response = await fetch(signed.url);
        const bytes = (await response.arrayBuffer()).byteLength;
        logger.log(
          `  signed file: ${signed.originalFileName} -> HTTP ${response.status}, ` +
            `${bytes} bytes, ${response.headers.get('content-type')}`,
        );
      }

      // Cross-vacancy substitution: this vacancy's owner must not reach a
      // vacancy they do not own.
      const foreign = TARGETS.find((t) => t.id !== target.id)!;
      try {
        await vacancies.listVacancyCandidates(
          vacancy.organizationId,
          vacancy.createdBy.id,
          foreign.id,
          { page: 1, limit: 10, skip: 0 },
        );
        logger.error(
          `  SECURITY: reached "${foreign.title}" without owning it`,
        );
      } catch (error) {
        logger.log(
          `  foreign vacancy correctly denied: ${(error as Error).message}`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
