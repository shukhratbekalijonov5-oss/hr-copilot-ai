-- Index-lag tracking, and the search indexes restored under the names Prisma
-- generates for them.
--
-- The rename matters more than it looks. These four indexes were originally
-- created with descriptive names (`..._trgm_idx`) that Prisma's own naming
-- convention would never produce, so Prisma read them as objects it did not
-- own and the next `prisma migrate dev` emitted a DROP for every one of them.
-- It then failed on an unrelated statement, having already dropped them —
-- leaving a database where every search silently became a sequential scan and
-- nothing reported an error. Matching Prisma's names is what stops that
-- happening again.

-- AlterTable
ALTER TABLE "external_jobs" ADD COLUMN "searchIndexedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "external_jobs_searchIndexedAt_idx"
  ON "external_jobs"("searchIndexedAt");

-- CreateIndex
-- Full-text retrieval over the generated, weighted document.
CREATE INDEX IF NOT EXISTS "external_jobs_searchDocument_idx"
  ON "external_jobs" USING GIN ("searchDocument");

-- CreateIndex
-- Trigram title matching: Korean agglutination, closed-up compounds, typos.
CREATE INDEX IF NOT EXISTS "external_jobs_title_idx"
  ON "external_jobs" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
-- Company-name matching. A job's company lives on another table, so the
-- generated tsvector could not reach it.
CREATE INDEX IF NOT EXISTS "external_companies_name_idx"
  ON "external_companies" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
-- The multi-location filter, live at last: a job whose PRIMARY office is New
-- York and whose second office is Toronto must answer a search for Canada.
CREATE INDEX IF NOT EXISTS "external_jobs_additionalLocations_idx"
  ON "external_jobs" USING GIN ("additionalLocations" jsonb_path_ops);
