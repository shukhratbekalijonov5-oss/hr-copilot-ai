-- Trigram matching. Needed because this catalogue is multilingual: PostgreSQL
-- ships no Korean text-search configuration (verified: pg_ts_config lists 28
-- languages and Korean is not among them), and the `simple` tokenizer splits
-- Hangul only on whitespace — so "개발자를" does not match a search for
-- "개발자", and "백엔드개발자" written closed up is a single token. Trigrams
-- have no language model at all, which is exactly why they cover the gap:
-- word_similarity('개발자', '백엔드 개발자 채용') = 1.0.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "external_jobs"
ADD COLUMN     "searchableUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The weighted search document, maintained by PostgreSQL itself.
--
-- GENERATED rather than a trigger or an application write: it cannot drift
-- from the row it describes, and no future code path can update a title while
-- forgetting the index. `to_tsvector(regconfig, text)` is IMMUTABLE (verified
-- against pg_proc), which is what makes this legal.
--
-- Weights are the search's field priority, read back by ts_rank_cd:
--   A  title and its normalized form  — what the job IS
--   B  city / region / country        — where it is
--   C  the first 8000 chars of the description
--
-- The description is truncated on purpose. Postings run to 200k characters,
-- and indexing all of it would triple the index for text that is boilerplate
-- by that depth — while an untruncated description would also let a long
-- posting outrank a job actually CALLED what the candidate searched for.
ALTER TABLE "external_jobs"
ADD COLUMN "searchDocument" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("normalizedTitle", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("city", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("region", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce("countryCode", '')), 'B') ||
  setweight(to_tsvector('simple', left(coalesce("description", ''), 8000)), 'C')
) STORED;

-- CreateTable
CREATE TABLE "candidate_external_search_runs" (
    "id" TEXT NOT NULL,
    "candidateAccountId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "intentFingerprint" TEXT NOT NULL,
    "universeRevision" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "query" TEXT,
    "strictCountries" TEXT[],
    "hardUniverseSize" INTEGER NOT NULL,
    "totalRanked" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "lexicalCandidates" INTEGER NOT NULL DEFAULT 0,
    "semanticCandidates" INTEGER NOT NULL DEFAULT 0,
    "semanticDegraded" BOOLEAN NOT NULL DEFAULT false,
    "fxSnapshotVersion" TEXT,
    "fxFetchedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_external_search_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_external_search_entries" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "externalJobId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "textScore" INTEGER,
    "intentScore" INTEGER,
    "reasons" JSONB NOT NULL,

    CONSTRAINT "candidate_external_search_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidate_external_search_runs_candidateAccountId_generated_idx" ON "candidate_external_search_runs"("candidateAccountId", "generatedAt");

-- CreateIndex
CREATE INDEX "candidate_external_search_runs_expiresAt_idx" ON "candidate_external_search_runs"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_external_search_runs_candidateAccountId_requestFi_key" ON "candidate_external_search_runs"("candidateAccountId", "requestFingerprint");

-- CreateIndex
CREATE INDEX "candidate_external_search_entries_runId_rank_idx" ON "candidate_external_search_entries"("runId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_external_search_entries_runId_externalJobId_key" ON "candidate_external_search_entries"("runId", "externalJobId");

-- CreateIndex
CREATE INDEX "external_jobs_status_searchableUpdatedAt_idx" ON "external_jobs"("status", "searchableUpdatedAt");

-- AddForeignKey
ALTER TABLE "candidate_external_search_runs" ADD CONSTRAINT "candidate_external_search_runs_candidateAccountId_fkey" FOREIGN KEY ("candidateAccountId") REFERENCES "candidate_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_external_search_entries" ADD CONSTRAINT "candidate_external_search_entries_runId_fkey" FOREIGN KEY ("runId") REFERENCES "candidate_external_search_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- Full-text retrieval. GIN because the question is "which rows contain these
-- lexemes", which is an inverted-index question; a btree cannot answer it.
CREATE INDEX "external_jobs_searchDocument_idx"
  ON "external_jobs" USING GIN ("searchDocument");

-- CreateIndex
-- Trigram title matching, for everything the tokenizer cannot reach: Korean
-- agglutination, closed-up compounds, and ordinary typos. gin_trgm_ops rather
-- than gist: reads dominate overwhelmingly here.
CREATE INDEX "external_jobs_title_idx"
  ON "external_jobs" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
-- Company-name matching. It lives on this table rather than on the job, so a
-- generated column could not reach it — searching "Vercel" resolves companies
-- first and then their jobs, both index-backed.
CREATE INDEX "external_companies_name_idx"
  ON "external_companies" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
-- The multi-location filter, live at last.
--
-- `additionalLocations` has been stored since Task 4B.3 and queried by
-- nothing. A candidate filtering for Canada must still see a job whose
-- PRIMARY office is New York and whose second office is Toronto, and without
-- this index that containment test is a sequential scan over the catalogue.
-- jsonb_path_ops is the narrower operator class — it supports only @>, which
-- is the only operator this query uses, and builds a smaller, faster index.
CREATE INDEX "external_jobs_additionalLocations_idx"
  ON "external_jobs" USING GIN ("additionalLocations" jsonb_path_ops);
