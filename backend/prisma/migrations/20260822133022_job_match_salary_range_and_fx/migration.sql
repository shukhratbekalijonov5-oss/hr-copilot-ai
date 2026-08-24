-- AlterTable
ALTER TABLE "candidate_job_match_runs" ADD COLUMN     "fxFetchedAt" TIMESTAMP(3),
ADD COLUMN     "fxSnapshotVersion" TEXT;

-- AlterTable
ALTER TABLE "candidate_job_preferences" ADD COLUMN     "desiredSalaryMax" INTEGER;
