-- Which order a stored search run was computed in.
--
-- Defaulted rather than nullable: every run that already exists was computed
-- before NEWEST existed, so RELEVANCE is not a guess about them — it is what
-- they are. The value is part of the request fingerprint, so the two orders
-- can never share a snapshot.
ALTER TABLE "candidate_external_search_runs" ADD COLUMN     "sort" TEXT NOT NULL DEFAULT 'RELEVANCE';
