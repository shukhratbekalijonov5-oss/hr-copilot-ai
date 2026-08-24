-- AlterTable
ALTER TABLE "external_ingestion_runs" ADD COLUMN     "jobsUnmerged" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceScope" TEXT;

-- AlterTable
ALTER TABLE "external_job_sources" ADD COLUMN     "sourceScope" TEXT;

-- CreateIndex
CREATE INDEX "external_job_sources_provider_sourceScope_status_idx" ON "external_job_sources"("provider", "sourceScope", "status");
