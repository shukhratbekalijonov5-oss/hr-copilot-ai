-- The employer's own publication timestamp for an external listing.
--
-- Additive and nullable on purpose. Existing rows stay NULL: there is nothing
-- in this database that could truthfully be backfilled into it. `firstSeenAt`
-- is when our crawler first saw a posting, `createdAt` is when the row was
-- written, `lastSeenAt` is when a source last listed it — none of them is a
-- statement by the employer, and writing one here would manufacture a fact.
-- The column fills as providers re-sync and supply real publication claims.
ALTER TABLE "external_jobs" ADD COLUMN     "employerPostedAt" TIMESTAMP(3);

-- Newest-first browsing over the current universe.
--
-- DESC in the index so `ORDER BY "employerPostedAt" DESC` reads forward
-- instead of sorting. Leading with `status` because every candidate-facing
-- query starts by excluding the closed and the expired.
CREATE INDEX "external_jobs_status_employerPostedAt_idx" ON "external_jobs"("status", "employerPostedAt" DESC);
