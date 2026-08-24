-- Job Match v2: intent-aware ranking snapshots.
--
-- PURELY ADDITIVE: nullable columns (plus one defaulted counter) on the two
-- snapshot tables. No existing table is otherwise altered and no row is
-- rewritten. Existing stored runs keep a NULL intentFingerprint and
-- algorithmVersion, which can never equal the current values — so every
-- pre-v2 snapshot simply recomputes on its next read. Nothing is backfilled:
-- a v1 row cannot honestly claim v2 scores it never computed.

-- AlterTable
ALTER TABLE "candidate_job_match_entries" ADD COLUMN     "alignments" JSONB,
ADD COLUMN     "capabilityScore" INTEGER,
ADD COLUMN     "intentScore" INTEGER;

-- AlterTable
ALTER TABLE "candidate_job_match_runs" ADD COLUMN     "algorithmVersion" TEXT,
ADD COLUMN     "excluded" JSONB,
ADD COLUMN     "intentFingerprint" TEXT,
ADD COLUMN     "totalExcluded" INTEGER NOT NULL DEFAULT 0;
