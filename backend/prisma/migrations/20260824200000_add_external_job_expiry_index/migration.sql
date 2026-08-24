-- Additive only: the hourly lifecycle revalidation pass scans for jobs whose
-- employer-stated deadline has passed (status IN ('ACTIVE','STALE') AND
-- "expiresAt" <= now()). Without this index that scan walks every current row.
CREATE INDEX "external_jobs_status_expiresAt_idx" ON "external_jobs"("status", "expiresAt");
