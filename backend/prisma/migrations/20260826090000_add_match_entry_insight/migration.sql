-- Advanced explainable match (algorithm v4): per-entry insight payload.
-- Additive and nullable; existing rows stay valid (they are stranded by the
-- algorithm-version bump and recompute lazily on next request).
ALTER TABLE "candidate_job_match_entries" ADD COLUMN "insight" JSONB;
